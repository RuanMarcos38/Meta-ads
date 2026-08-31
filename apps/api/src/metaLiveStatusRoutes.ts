import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { z } from 'zod';
import { env } from './config/env.js';
import { prisma } from './shared/prisma.js';
import { decrypt } from './shared/crypto.js';
import { fail, ok } from './shared/response.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { resolveAccountFinancialState, resolveCampaignDeliveryState } from './metaLiveStatus.js';

const restrictedRoles = new Set(['CLIENT', 'MANAGER']);
const CACHE_TTL_MS = 45_000;
const base = () => `https://graph.facebook.com/${env.meta.apiVersion}`;

const querySchema = z.object({
  clientId: z.string().uuid().optional(),
  businessId: z.string().trim().min(1).max(100).optional(),
  adAccountId: z.string().uuid().optional(),
  force: z.enum(['true', 'false']).optional(),
});

type CacheItem = { expiresAt: number; value: any };
const accountCache = new Map<string, CacheItem>();
const campaignCache = new Map<string, CacheItem>();

async function graphObjectWithFallback(path: string, accessToken: string, fieldOptions: string[]) {
  let lastError: any;
  for (const fields of fieldOptions) {
    try {
      const response = await axios.get(`${base()}/${path}`, { params: { access_token: accessToken, fields } });
      return response.data;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function graphPaged(path: string, accessToken: string, fields: string) {
  const rows: any[] = [];
  let next: string | undefined = `${base()}/${path}`;
  let params: Record<string, string> | undefined = { access_token: accessToken, fields, limit: '200' };
  while (next) {
    const response: any = await axios.get(next, { params });
    rows.push(...(response.data?.data || []));
    next = response.data?.paging?.next;
    params = undefined;
  }
  return rows;
}

function cached(map: Map<string, CacheItem>, key: string, force: boolean) {
  if (force) return null;
  const current = map.get(key);
  if (!current || current.expiresAt <= Date.now()) return null;
  return current.value;
}

function store(map: Map<string, CacheItem>, key: string, value: any) {
  map.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function resolvedAccounts(user: AuthUser, rawQuery: unknown, reply: any) {
  const parsed = querySchema.safeParse(rawQuery);
  if (!parsed.success) {
    reply.code(400).send(fail('VALIDATION', 'Filtros de conta Meta inválidos.'));
    return null;
  }
  const clientId = scopeClient(user, parsed.data.clientId);
  if (!clientId) {
    if (restrictedRoles.has(user.role)) reply.code(403).send(fail('CLIENT_SCOPE_REQUIRED', 'Este usuário precisa estar vinculado a uma empresa.'));
    else return { accounts: [], force: parsed.data.force === 'true' };
    return null;
  }
  const businessId = restrictedRoles.has(user.role) ? user.businessId : parsed.data.businessId;
  if (restrictedRoles.has(user.role) && !businessId) {
    reply.code(403).send(fail('BUSINESS_SCOPE_REQUIRED', 'Este usuário precisa estar vinculado a uma Business Manager.'));
    return null;
  }
  const accounts = await prisma.metaAdAccount.findMany({
    where: {
      organizationId: user.organizationId!,
      clientId,
      isActive: true,
      ...(restrictedRoles.has(user.role) ? { isAssigned: true } : {}),
      ...(businessId ? { businessId } : {}),
      ...(parsed.data.adAccountId ? { id: parsed.data.adAccountId } : {}),
    },
    include: { connection: true },
    orderBy: [{ businessName: 'asc' }, { name: 'asc' }],
  });
  return { accounts, force: parsed.data.force === 'true' };
}

async function liveAccount(account: any, force: boolean) {
  const key = account.id;
  const fromCache = cached(accountCache, key, force);
  if (fromCache) return fromCache;
  if (account.connection?.status !== 'active') {
    return store(accountCache, key, {
      id: account.id,
      accountId: account.accountId,
      name: account.name,
      currency: account.currency,
      businessId: account.businessId,
      businessName: account.businessName,
      error: 'Conexão Meta inativa.',
      updatedAt: new Date().toISOString(),
    });
  }
  const token = decrypt(account.connection.accessTokenEncrypted);
  const actId = String(account.accountId).startsWith('act_') ? String(account.accountId) : `act_${account.accountId}`;
  const raw = await graphObjectWithFallback(actId, token, [
    'account_id,name,currency,account_status,disable_reason,amount_spent,balance,spend_cap,is_prepay_account,funding_source_details,failed_delivery_checks',
    'account_id,name,currency,account_status,disable_reason,amount_spent,balance,spend_cap,is_prepay_account,funding_source_details',
    'account_id,name,currency,account_status,disable_reason,amount_spent,balance,spend_cap,is_prepay_account',
    'account_id,name,currency,account_status,amount_spent,balance,spend_cap',
    'account_id,name,currency,account_status',
  ]);
  return store(accountCache, key, {
    id: account.id,
    accountId: account.accountId,
    name: raw?.name || account.name,
    currency: raw?.currency || account.currency,
    businessId: account.businessId,
    businessName: account.businessName,
    ...resolveAccountFinancialState(raw),
    updatedAt: new Date().toISOString(),
  });
}

async function liveCampaigns(account: any, force: boolean, financial: any) {
  const key = account.id;
  const fromCache = cached(campaignCache, key, force);
  if (fromCache) return fromCache;
  if (account.connection?.status !== 'active') return [];
  const token = decrypt(account.connection.accessTokenEncrypted);
  const actId = String(account.accountId).startsWith('act_') ? String(account.accountId) : `act_${account.accountId}`;
  let campaigns: any[] = [];
  try {
    campaigns = await graphPaged(`${actId}/campaigns`, token, 'id,name,status,configured_status,effective_status,issues_info,objective,updated_time');
  } catch {
    campaigns = await graphPaged(`${actId}/campaigns`, token, 'id,name,status,effective_status,objective,updated_time');
  }
  const value = campaigns.map((campaign) => ({
    metaCampaignId: String(campaign.id),
    name: campaign.name ? String(campaign.name) : null,
    configuredStatus: campaign.configured_status || campaign.status || null,
    effectiveStatus: campaign.effective_status || null,
    objective: campaign.objective || null,
    issues: Array.isArray(campaign.issues_info) ? campaign.issues_info.slice(0, 10).map((issue: any) => ({
      code: issue?.error_code ?? null,
      summary: issue?.error_summary ? String(issue.error_summary) : null,
      message: issue?.error_message ? String(issue.error_message) : null,
      level: issue?.level ? String(issue.level) : null,
    })) : [],
    ...resolveCampaignDeliveryState(campaign, financial),
    updatedAt: campaign.updated_time || new Date().toISOString(),
    adAccountId: account.id,
    accountId: account.accountId,
  }));
  return store(campaignCache, key, value);
}

export async function registerMetaLiveStatusRoutes(app: FastifyInstance) {
  app.get('/meta/live/accounts', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const resolved = await resolvedAccounts(user, req.query, reply);
    if (!resolved) return;
    const rows = [];
    for (const account of resolved.accounts) {
      try {
        rows.push(await liveAccount(account, resolved.force));
      } catch (error: any) {
        req.log.warn({ err: error, accountId: account.id }, 'live account billing lookup failed');
        rows.push({
          id: account.id,
          accountId: account.accountId,
          name: account.name,
          currency: account.currency,
          businessId: account.businessId,
          businessName: account.businessName,
          error: 'A Meta não disponibilizou os dados de cobrança desta conta agora.',
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return ok({ rows, cacheSeconds: CACHE_TTL_MS / 1000, source: 'Meta Graph API' });
  });

  app.get('/meta/live/campaigns', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const resolved = await resolvedAccounts(user, req.query, reply);
    if (!resolved) return;
    const rows: any[] = [];
    for (const account of resolved.accounts) {
      try {
        const financial = await liveAccount(account, resolved.force);
        rows.push(...await liveCampaigns(account, resolved.force, financial?.error ? null : financial));
      } catch (error: any) {
        req.log.warn({ err: error, accountId: account.id }, 'live campaign status lookup failed');
      }
    }
    return ok({ rows, cacheSeconds: CACHE_TTL_MS / 1000, source: 'Meta Graph API' });
  });
}
