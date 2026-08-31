import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import axios from 'axios';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { ok, fail } from './shared/response.js';
import { decrypt, encrypt } from './shared/crypto.js';
import { MetaAdsService } from './modules/meta/MetaAdsService.js';

const adminRoles = ['SUPER_ADMIN', 'AGENCY_ADMIN'] as const;
const tenantRoles = new Set(['CLIENT', 'MANAGER']);
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const GA_CONFIG_ACTION = 'MARKETING_GA4_CONFIG';
const PIXEL_CONFIG_ACTION = 'MARKETING_PIXEL_CONFIG';

function effectiveClientId(user: AuthUser, requested?: string) {
  return scopeClient(user, requested);
}

function effectiveBusinessId(user: AuthUser, requested?: string) {
  if (tenantRoles.has(user.role)) return user.businessId || '__NO_BUSINESS__';
  return requested;
}

async function requireClient(user: AuthUser, requested: string | undefined, reply: FastifyReply) {
  const clientId = effectiveClientId(user, requested);
  if (!clientId) {
    reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa.'));
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

async function activeMetaConnection(organizationId: string, clientId: string) {
  return prisma.metaConnection.findFirst({
    where: { organizationId, clientId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  });
}

function base64url(value: Buffer | string) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return source.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

type GaConfig = {
  propertyId: string;
  serviceAccountEmail: string;
  privateKeyEncrypted: string;
};

type PixelConfig = {
  pixelId: string;
  pixelName: string;
  businessId: string;
};

async function latestConfig<T>(organizationId: string, action: string, entityId: string) {
  const log = await prisma.auditLog.findFirst({
    where: { organizationId, action, entityId },
    orderBy: { createdAt: 'desc' },
  });
  return log ? { value: (log.metadataJson || {}) as T, createdAt: log.createdAt } : null;
}

async function googleAccessToken(config: GaConfig) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: config.serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(decrypt(config.privateKeyEncrypted));
  const assertion = `${unsigned}.${base64url(signature)}`;
  const form = new URLSearchParams();
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  form.set('assertion', assertion);
  const response = await axios.post('https://oauth2.googleapis.com/token', form, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
  });
  return String(response.data?.access_token || '');
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTransaction(row: any) {
  return {
    id: String(row?.id || row?.transaction_id || ''),
    date: row?.time || row?.created_time || row?.date || row?.billing_date || null,
    type: row?.type || row?.charge_type || row?.transaction_type || row?.action || 'TRANSACTION',
    status: row?.status || row?.payment_status || null,
    amount: row?.amount ?? row?.net_amount ?? row?.charged_amount ?? null,
    currency: row?.currency || null,
    description: row?.description || row?.reason || row?.product || null,
  };
}

function inPeriod(value: unknown, since: string, until: string) {
  if (!value) return true;
  const time = new Date(String(value)).getTime();
  if (Number.isNaN(time)) return true;
  const start = new Date(`${since}T00:00:00.000Z`).getTime();
  const end = new Date(`${until}T23:59:59.999Z`).getTime();
  return time >= start && time <= end;
}

export async function registerMarketingIntelligenceRoutes(app: FastifyInstance) {
  app.get('/workspace/finance', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({
      clientId: z.string().uuid().optional(),
      businessId: z.string().optional(),
      adAccountId: z.string().uuid().optional(),
      since: dateText,
      until: dateText,
    }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtros financeiros inválidos.'));
    if (query.data.since > query.data.until) return reply.code(400).send(fail('VALIDATION', 'O início do período deve ser anterior ao fim.'));

    const client = await requireClient(user, query.data.clientId, reply);
    if (!client) return;
    const businessId = effectiveBusinessId(user, query.data.businessId);
    if (tenantRoles.has(user.role) && businessId === '__NO_BUSINESS__') return reply.code(403).send(fail('TENANT_SCOPE_REQUIRED', 'Este usuário precisa estar vinculado a uma BM.'));

    const connection = await activeMetaConnection(user.organizationId!, client.id);
    if (!connection) return reply.code(409).send(fail('META_NOT_CONNECTED', 'A Meta não está conectada para esta empresa.'));

    const accounts = await prisma.metaAdAccount.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId: client.id,
        isActive: true,
        isAssigned: true,
        ...(businessId && businessId !== '__NO_BUSINESS__' ? { businessId } : {}),
        ...(query.data.adAccountId ? { id: query.data.adAccountId } : {}),
      },
      select: { id: true, accountId: true, name: true, currency: true, businessId: true, businessName: true },
      orderBy: [{ businessName: 'asc' }, { name: 'asc' }],
    });

    const meta = new MetaAdsService(decrypt(connection.accessTokenEncrypted));
    const result = await Promise.all(accounts.map(async (account) => {
      let financial: any = null;
      let financialError: string | null = null;
      let transactions: any[] = [];
      let transactionsError: string | null = null;
      try {
        financial = await meta.accountFinance(`act_${account.accountId}`);
      } catch (error: any) {
        financialError = error?.response?.data?.error?.message || error?.message || 'Dados financeiros indisponíveis na Meta.';
      }
      try {
        const rows = await meta.transactions(`act_${account.accountId}`, query.data.since, query.data.until);
        transactions = rows.map(normalizeTransaction).filter((row) => inPeriod(row.date, query.data.since, query.data.until));
      } catch (error: any) {
        transactionsError = error?.response?.data?.error?.message || error?.message || 'O token atual não permite consultar o histórico de transações.';
      }
      return {
        ...account,
        finance: financial ? {
          amountSpent: financial.amount_spent ?? null,
          balance: financial.balance ?? null,
          spendCap: financial.spend_cap ?? null,
          currency: financial.currency || account.currency || null,
          fundingSource: financial.funding_source || null,
          fundingSourceDetails: financial.funding_source_details || null,
          isPrepayAccount: financial.is_prepay_account ?? null,
          timezone: financial.timezone_name || null,
        } : null,
        financialError,
        transactionsAvailable: !transactionsError,
        transactionsError,
        transactions,
      };
    }));

    return ok({ client, businessId: businessId === '__NO_BUSINESS__' ? null : businessId, since: query.data.since, until: query.data.until, accounts: result });
  });

  app.get('/workspace/google-analytics/config', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));
    const client = await requireClient(user, query.data.clientId, reply);
    if (!client) return;
    const config = await latestConfig<GaConfig>(user.organizationId!, GA_CONFIG_ACTION, client.id);
    return ok({
      client,
      configured: Boolean(config?.value?.propertyId && config?.value?.serviceAccountEmail && config?.value?.privateKeyEncrypted),
      propertyId: config?.value?.propertyId || null,
      serviceAccountEmail: config?.value?.serviceAccountEmail || null,
      updatedAt: config?.createdAt || null,
    });
  });

  app.put('/workspace/google-analytics/config', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({
      clientId: z.string().uuid(),
      propertyId: z.string().min(1),
      serviceAccountJson: z.string().min(20),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Informe empresa, Property ID e JSON da conta de serviço.'));
    const client = await requireClient(user, body.data.clientId, reply);
    if (!client) return;

    let credential: any;
    try { credential = JSON.parse(body.data.serviceAccountJson); }
    catch { return reply.code(400).send(fail('GA_CREDENTIAL_INVALID', 'O JSON da conta de serviço não é válido.')); }
    const email = String(credential?.client_email || '').trim();
    const privateKey = String(credential?.private_key || '').replace(/\\n/g, '\n').trim();
    if (!email || !privateKey.includes('PRIVATE KEY')) return reply.code(400).send(fail('GA_CREDENTIAL_INVALID', 'O JSON precisa conter client_email e private_key.'));

    const metadata: GaConfig = {
      propertyId: body.data.propertyId.replace(/^properties\//, '').trim(),
      serviceAccountEmail: email,
      privateKeyEncrypted: encrypt(privateKey),
    };
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: GA_CONFIG_ACTION,
        entity: 'GoogleAnalytics4',
        entityId: client.id,
        metadataJson: metadata as unknown as Prisma.InputJsonValue,
      },
    });
    return ok({ clientId: client.id, propertyId: metadata.propertyId, serviceAccountEmail: metadata.serviceAccountEmail }, 'Google Analytics configurado para a empresa.');
  });

  app.get('/workspace/google-analytics/report', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional(), since: dateText, until: dateText }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Período do Google Analytics inválido.'));
    if (query.data.since > query.data.until) return reply.code(400).send(fail('VALIDATION', 'O início do período deve ser anterior ao fim.'));
    const client = await requireClient(user, query.data.clientId, reply);
    if (!client) return;
    const stored = await latestConfig<GaConfig>(user.organizationId!, GA_CONFIG_ACTION, client.id);
    if (!stored?.value?.propertyId) return reply.code(409).send(fail('GA_NOT_CONFIGURED', 'Google Analytics ainda não foi configurado para esta empresa.'));

    try {
      const accessToken = await googleAccessToken(stored.value);
      if (!accessToken) throw new Error('Google não retornou token de acesso.');
      const response = await axios.post(
        `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(stored.value.propertyId)}:runReport`,
        {
          dateRanges: [{ startDate: query.data.since, endDate: query.data.until }],
          dimensions: [{ name: 'date' }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'sessions' },
            { name: 'screenPageViews' },
            { name: 'keyEvents' },
            { name: 'transactions' },
            { name: 'totalRevenue' },
          ],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
          limit: 10000,
        },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 25000 },
      );
      const rows = Array.isArray(response.data?.rows) ? response.data.rows : [];
      const series = rows.map((row: any) => {
        const date = String(row?.dimensionValues?.[0]?.value || '');
        const values = row?.metricValues || [];
        return {
          date,
          activeUsers: numberValue(values[0]?.value),
          sessions: numberValue(values[1]?.value),
          pageViews: numberValue(values[2]?.value),
          keyEvents: numberValue(values[3]?.value),
          transactions: numberValue(values[4]?.value),
          revenue: numberValue(values[5]?.value),
        };
      });
      const totals = series.reduce((acc, row) => ({
        activeUsers: acc.activeUsers + row.activeUsers,
        sessions: acc.sessions + row.sessions,
        pageViews: acc.pageViews + row.pageViews,
        keyEvents: acc.keyEvents + row.keyEvents,
        transactions: acc.transactions + row.transactions,
        revenue: acc.revenue + row.revenue,
      }), { activeUsers: 0, sessions: 0, pageViews: 0, keyEvents: 0, transactions: 0, revenue: 0 });
      return ok({ client, propertyId: stored.value.propertyId, since: query.data.since, until: query.data.until, totals, series });
    } catch (error: any) {
      const message = error?.response?.data?.error?.message || error?.message || 'Falha ao consultar o Google Analytics.';
      return reply.code(502).send(fail('GA_REPORT_FAILED', message));
    }
  });

  app.get('/workspace/meta-pixels', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional(), businessId: z.string().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtros do Pixel inválidos.'));
    const client = await requireClient(user, query.data.clientId, reply);
    if (!client) return;
    const businessId = effectiveBusinessId(user, query.data.businessId);
    if (!businessId || businessId === '__NO_BUSINESS__') return reply.code(400).send(fail('BUSINESS_REQUIRED', 'Selecione uma Business Manager.'));

    const stored = await latestConfig<PixelConfig>(user.organizationId!, PIXEL_CONFIG_ACTION, `${client.id}:${businessId}`);
    const connection = await activeMetaConnection(user.organizationId!, client.id);
    let pixels: any[] = [];
    let error: string | null = null;
    if (connection) {
      const accounts = await prisma.metaAdAccount.findMany({
        where: { organizationId: user.organizationId!, clientId: client.id, businessId, isActive: true, isAssigned: true },
        select: { accountId: true },
      });
      const meta = new MetaAdsService(decrypt(connection.accessTokenEncrypted));
      const map = new Map<string, any>();
      for (const account of accounts) {
        try {
          for (const pixel of await meta.adAccountPixels(`act_${account.accountId}`)) {
            const id = String(pixel?.id || '');
            if (id && !map.has(id)) map.set(id, { id, name: pixel?.name || `Pixel ${id}`, lastFiredTime: pixel?.last_fired_time || null });
          }
        } catch (err: any) {
          error = err?.response?.data?.error?.message || err?.message || 'Não foi possível listar Pixels desta conta.';
        }
      }
      pixels = Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }
    return ok({
      client,
      businessId,
      configured: Boolean(stored?.value?.pixelId),
      selectedPixel: stored?.value || null,
      updatedAt: stored?.createdAt || null,
      pixels,
      discoveryError: error,
    });
  });

  app.put('/workspace/meta-pixels/config', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid(), businessId: z.string().min(1), pixelId: z.string().min(1), pixelName: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Empresa, BM e Pixel são obrigatórios.'));
    const client = await requireClient(user, body.data.clientId, reply);
    if (!client) return;
    const manager = await prisma.businessManager.findFirst({ where: { organizationId: user.organizationId!, clientId: client.id, metaBusinessId: body.data.businessId, status: 'active' } });
    if (!manager) return reply.code(404).send(fail('BUSINESS_NOT_FOUND', 'Business Manager não pertence à empresa selecionada.'));

    const metadata: PixelConfig = { pixelId: body.data.pixelId, pixelName: body.data.pixelName, businessId: body.data.businessId };
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        businessId: body.data.businessId,
        action: PIXEL_CONFIG_ACTION,
        entity: 'MetaPixel',
        entityId: `${client.id}:${body.data.businessId}`,
        metadataJson: metadata as unknown as Prisma.InputJsonValue,
      },
    });
    return ok(metadata, 'Pixel vinculado à empresa e à Business Manager.');
  });

  app.get('/workspace/meta-pixels/stats', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional(), businessId: z.string().optional(), since: dateText, until: dateText }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtros do Pixel inválidos.'));
    const client = await requireClient(user, query.data.clientId, reply);
    if (!client) return;
    const businessId = effectiveBusinessId(user, query.data.businessId);
    if (!businessId || businessId === '__NO_BUSINESS__') return reply.code(400).send(fail('BUSINESS_REQUIRED', 'Selecione uma Business Manager.'));
    const stored = await latestConfig<PixelConfig>(user.organizationId!, PIXEL_CONFIG_ACTION, `${client.id}:${businessId}`);
    if (!stored?.value?.pixelId) return reply.code(409).send(fail('PIXEL_NOT_CONFIGURED', 'Nenhum Pixel foi vinculado a esta empresa/BM.'));
    const connection = await activeMetaConnection(user.organizationId!, client.id);
    if (!connection) return reply.code(409).send(fail('META_NOT_CONNECTED', 'A Meta não está conectada para esta empresa.'));

    try {
      const meta = new MetaAdsService(decrypt(connection.accessTokenEncrypted));
      const stats = await meta.pixelStats(stored.value.pixelId, query.data.since, query.data.until);
      return ok({
        client,
        businessId,
        pixel: stored.value,
        since: query.data.since,
        until: query.data.until,
        retentionNotice: 'A disponibilidade histórica do endpoint de estatísticas do Pixel depende da retenção e das permissões da Meta.',
        stats,
      });
    } catch (error: any) {
      const message = error?.response?.data?.error?.message || error?.message || 'Falha ao consultar métricas do Pixel.';
      return reply.code(502).send(fail('PIXEL_STATS_FAILED', message));
    }
  });
}
