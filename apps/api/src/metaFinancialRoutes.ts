import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { z } from 'zod';
import { env } from './config/env.js';
import { prisma } from './shared/prisma.js';
import { decrypt } from './shared/crypto.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  clientId: z.string().uuid().optional(),
  businessId: z.string().trim().min(1).max(100).optional(),
  adAccountId: z.string().uuid().optional(),
});
const activityQuerySchema = querySchema.extend({
  adAccountId: z.string().uuid(),
  since: dateText.optional(),
  until: dateText.optional(),
});

const BILLING_EVENT_LABELS: Record<string, string> = {
  funding_event_initiated: 'Recarga iniciada',
  funding_event_successful: 'Recarga concluída',
  add_funding_source: 'Forma de pagamento adicionada',
  remove_funding_source: 'Forma de pagamento removida',
  ad_account_billing_charge: 'Cobrança realizada',
  ad_account_billing_charge_failed: 'Falha na cobrança',
  ad_account_billing_chargeback: 'Estorno de cobrança',
  ad_account_billing_chargeback_reversal: 'Reversão de estorno',
  ad_account_billing_decline: 'Cobrança recusada',
  ad_account_billing_refund: 'Reembolso',
  account_spending_limit_reached: 'Limite de gastos da conta atingido',
  ad_account_remove_spend_limit: 'Limite de gastos removido',
  ad_account_reset_spend_limit: 'Limite de gastos redefinido',
  ad_account_update_spend_limit: 'Limite de gastos atualizado',
  billing_event: 'Atividade de faturamento',
};
const BILLING_EVENTS = new Set(Object.keys(BILLING_EVENT_LABELS));
const ZERO_DECIMAL_CURRENCIES = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

function baseUrl() {
  return `https://graph.facebook.com/${env.meta.apiVersion}`;
}

function minorToMajor(value: unknown, currency: string) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric / (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100);
}

function parseExtraData(value: unknown) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return { detalhe: String(value) }; }
}

function graphError(error: any) {
  return String(error?.response?.data?.error?.message || error?.message || 'Falha ao consultar os dados financeiros da Meta.');
}

async function getGraph(path: string, token: string, params: Record<string, unknown>) {
  const response = await axios.get(`${baseUrl()}/${path.replace(/^\//, '')}`, {
    params: { ...params, access_token: token },
    timeout: 20_000,
  });
  return response.data;
}

async function getPagedGraph(path: string, token: string, params: Record<string, unknown>) {
  const rows: any[] = [];
  let next: string | null = `${baseUrl()}/${path.replace(/^\//, '')}`;
  let requestParams: Record<string, unknown> | undefined = { ...params, access_token: token };
  let pages = 0;
  while (next && pages < 10) {
    const response: any = await axios.get(next, { params: requestParams, timeout: 20_000 });
    rows.push(...(response.data?.data || []));
    next = response.data?.paging?.next || null;
    requestParams = undefined;
    pages += 1;
  }
  return rows;
}

async function resolveClient(user: AuthUser, requestedClientId: string | undefined, reply: any) {
  const clientId = scopeClient(user, requestedClientId);
  if (!clientId) {
    reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa para consultar os saldos.'));
    return null;
  }
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: user.organizationId! },
    select: { id: true, name: true },
  });
  if (!client) {
    reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para este acesso.'));
    return null;
  }
  return client;
}

export async function registerMetaFinancialRoutes(app: FastifyInstance) {
  app.get('/financial/meta-overview', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = querySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Escopo financeiro inválido.'));
    const client = await resolveClient(user, query.data.clientId, reply);
    if (!client) return;

    const accounts = await prisma.metaAdAccount.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId: client.id,
        isActive: true,
        isAssigned: true,
        ...(query.data.businessId ? { businessId: query.data.businessId } : {}),
        ...(query.data.adAccountId ? { id: query.data.adAccountId } : {}),
      },
      include: { connection: true },
      orderBy: [{ businessName: 'asc' }, { name: 'asc' }],
      take: 50,
    });

    if (query.data.adAccountId && !accounts.length) {
      return reply.code(404).send(fail('META_ACCOUNT_NOT_ASSIGNED', 'A conta Meta selecionada não pertence ao escopo atual.'));
    }

    const rows = await Promise.all(accounts.map(async (account) => {
      const currency = String(account.currency || 'BRL').toUpperCase();
      if (account.connection.status !== 'active') {
        return {
          id: account.id,
          accountId: account.accountId,
          name: account.name || `Conta ${account.accountId}`,
          businessId: account.businessId,
          businessName: account.businessName,
          currency,
          available: false,
          error: 'Conexão Meta inativa.',
        };
      }

      try {
        const token = decrypt(account.connection.accessTokenEncrypted);
        const actId = String(account.accountId).startsWith('act_') ? String(account.accountId) : `act_${account.accountId}`;
        const data = await getGraph(actId, token, {
          fields: 'id,account_id,name,currency,account_status,amount_spent,balance,spend_cap,funding_source_details,is_prepay_account,timezone_name',
        });
        const liveCurrency = String(data?.currency || currency).toUpperCase();
        return {
          id: account.id,
          accountId: String(data?.account_id || account.accountId).replace(/^act_/, ''),
          name: String(data?.name || account.name || `Conta ${account.accountId}`),
          businessId: account.businessId,
          businessName: account.businessName,
          currency: liveCurrency,
          accountStatus: data?.account_status == null ? account.accountStatus : Number(data.account_status),
          balance: minorToMajor(data?.balance, liveCurrency),
          amountSpent: minorToMajor(data?.amount_spent, liveCurrency),
          spendCap: minorToMajor(data?.spend_cap, liveCurrency),
          isPrepayAccount: Boolean(data?.is_prepay_account),
          fundingSource: data?.funding_source_details || null,
          timezone: data?.timezone_name || account.timezone || null,
          available: true,
          checkedAt: new Date().toISOString(),
        };
      } catch (error: any) {
        return {
          id: account.id,
          accountId: account.accountId,
          name: account.name || `Conta ${account.accountId}`,
          businessId: account.businessId,
          businessName: account.businessName,
          currency,
          available: false,
          error: graphError(error),
        };
      }
    }));

    const totalsByCurrency = new Map<string, { currency: string; balance: number; amountSpent: number; spendCap: number; accounts: number }>();
    rows.filter((row: any) => row.available).forEach((row: any) => {
      const current = totalsByCurrency.get(row.currency) || { currency: row.currency, balance: 0, amountSpent: 0, spendCap: 0, accounts: 0 };
      current.balance += Number(row.balance || 0);
      current.amountSpent += Number(row.amountSpent || 0);
      current.spendCap += Number(row.spendCap || 0);
      current.accounts += 1;
      totalsByCurrency.set(row.currency, current);
    });

    return ok({
      client,
      scope: { businessId: query.data.businessId || null, adAccountId: query.data.adAccountId || null },
      accounts: rows,
      totalsByCurrency: Array.from(totalsByCurrency.values()),
      source: 'Meta Marketing API',
      updatedAt: new Date().toISOString(),
      refreshRecommendedSeconds: 60,
    });
  });

  app.get('/financial/meta-activity', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = activityQuerySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Conta ou período de atividade inválido.'));
    const client = await resolveClient(user, query.data.clientId, reply);
    if (!client) return;

    const account = await prisma.metaAdAccount.findFirst({
      where: {
        id: query.data.adAccountId,
        organizationId: user.organizationId!,
        clientId: client.id,
        isActive: true,
        isAssigned: true,
        ...(query.data.businessId ? { businessId: query.data.businessId } : {}),
      },
      include: { connection: true },
    });
    if (!account) return reply.code(404).send(fail('META_ACCOUNT_NOT_ASSIGNED', 'A conta Meta selecionada não pertence ao escopo atual.'));
    if (account.connection.status !== 'active') return reply.code(409).send(fail('META_CONNECTION_REQUIRED', 'A conexão Meta desta conta está inativa.'));

    const until = query.data.until || new Date().toISOString().slice(0, 10);
    const defaultSince = new Date();
    defaultSince.setDate(defaultSince.getDate() - 90);
    const since = query.data.since || defaultSince.toISOString().slice(0, 10);
    if (since > until) return reply.code(400).send(fail('VALIDATION', 'A data inicial precisa ser anterior à data final.'));

    try {
      const token = decrypt(account.connection.accessTokenEncrypted);
      const actId = String(account.accountId).startsWith('act_') ? String(account.accountId) : `act_${account.accountId}`;
      const rows = await getPagedGraph(`${actId}/activities`, token, {
        fields: 'actor_id,actor_name,application_name,date_time_in_timezone,event_time,event_type,extra_data,object_id,object_name,object_type,tool,translated_event_type',
        category: 'ACCOUNT',
        since: `${since}T00:00:00`,
        until: `${until}T23:59:59`,
        limit: '500',
      });

      const billingRows = rows
        .filter((row: any) => BILLING_EVENTS.has(String(row?.event_type || '')))
        .map((row: any) => ({
          eventType: String(row?.event_type || ''),
          label: BILLING_EVENT_LABELS[String(row?.event_type || '')] || String(row?.translated_event_type || 'Atividade financeira'),
          translatedEventType: row?.translated_event_type || null,
          eventTime: row?.date_time_in_timezone || row?.event_time || null,
          actorName: row?.actor_name || 'Meta / sistema',
          applicationName: row?.application_name || null,
          objectName: row?.object_name || account.name || null,
          objectType: row?.object_type || null,
          tool: row?.tool || null,
          details: parseExtraData(row?.extra_data),
        }))
        .sort((a: any, b: any) => String(b.eventTime || '').localeCompare(String(a.eventTime || '')));

      return ok({
        account: { id: account.id, accountId: account.accountId, name: account.name, currency: account.currency, businessName: account.businessName },
        period: { since, until },
        activities: billingRows,
        source: 'Meta Marketing API · Atividade da conta',
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return reply.code(502).send(fail('META_FINANCIAL_ACTIVITY_ERROR', 'Não foi possível consultar a atividade financeira da conta Meta.', { detail: process.env.NODE_ENV === 'production' ? undefined : graphError(error) }));
    }
  });
}
