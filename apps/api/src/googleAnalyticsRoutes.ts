import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { decrypt, encrypt } from './shared/crypto.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

const GOOGLE_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const PRODUCTION_REDIRECT_URI = 'https://api-gestao.r2rmarketingdigital.com.br/google-analytics/oauth/callback';
const adminRoles = ['SUPER_ADMIN', 'AGENCY_ADMIN'] as const;
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function googleConfig() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    clientId: process.env.GOOGLE_ANALYTICS_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || '',
    clientSecret: process.env.GOOGLE_ANALYTICS_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || '',
    redirectUri: isProduction
      ? PRODUCTION_REDIRECT_URI
      : process.env.GOOGLE_ANALYTICS_REDIRECT_URI?.trim() || PRODUCTION_REDIRECT_URI,
  };
}

function configurationReady() {
  const cfg = googleConfig();
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri);
}

function htmlPage(title: string, message: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:Arial,sans-serif;background:#0f172a;color:#e5e7eb;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:560px;padding:32px;border:1px solid #334155;border-radius:16px;background:#111827}h1{margin:0 0 12px;font-size:24px}p{line-height:1.55;color:#cbd5e1}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

function googleErrorMessage(error: any) {
  return String(
    error?.response?.data?.error?.message
    || error?.response?.data?.error_description
    || error?.message
    || 'Falha ao consultar o Google Analytics.',
  );
}

async function ensureClient(user: AuthUser, requestedClientId: string | undefined, reply: any) {
  const clientId = scopeClient(user, requestedClientId);
  if (!clientId) {
    reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa para consultar o Google Analytics.'));
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

async function refreshAccessToken(connection: any) {
  const cfg = googleConfig();
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('Credenciais OAuth do Google Analytics não configuradas.');
  if (!connection.refreshTokenEncrypted) throw new Error('Token de renovação do Google Analytics ausente. Reconecte a conta Google.');

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: decrypt(connection.refreshTokenEncrypted),
    grant_type: 'refresh_token',
  });
  const response = await axios.post('https://oauth2.googleapis.com/token', body, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });
  const accessToken = String(response.data?.access_token || '');
  if (!accessToken) throw new Error('O Google não retornou um novo token de acesso.');
  const expiresIn = Number(response.data?.expires_in || 3600);
  const tokenExpiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000);
  await prisma.googleAnalyticsConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encrypt(accessToken),
      tokenExpiresAt,
      status: 'active',
      lastError: null,
    },
  });
  return accessToken;
}

async function accessToken(connection: any) {
  const validUntil = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  if (connection.accessTokenEncrypted && validUntil > Date.now() + 60_000) {
    return decrypt(connection.accessTokenEncrypted);
  }
  return refreshAccessToken(connection);
}

async function listProperties(token: string) {
  const rows: Array<{ propertyId: string; propertyName: string; accountName: string; accountId: string }> = [];
  let pageToken = '';
  do {
    const response = await axios.get('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
      headers: { Authorization: `Bearer ${token}` },
      params: { pageSize: 200, ...(pageToken ? { pageToken } : {}) },
      timeout: 20_000,
    });
    for (const account of response.data?.accountSummaries || []) {
      const accountId = String(account.account || '').replace(/^accounts\//, '');
      const accountName = String(account.displayName || `Conta ${accountId}`);
      for (const property of account.propertySummaries || []) {
        const propertyId = String(property.property || '').replace(/^properties\//, '');
        if (!propertyId) continue;
        rows.push({
          propertyId,
          propertyName: String(property.displayName || `Propriedade ${propertyId}`),
          accountName,
          accountId,
        });
      }
    }
    pageToken = String(response.data?.nextPageToken || '');
  } while (pageToken);
  return rows.sort((a, b) => `${a.accountName} ${a.propertyName}`.localeCompare(`${b.accountName} ${b.propertyName}`));
}

async function runReport(token: string, propertyId: string, body: Record<string, unknown>) {
  const response = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    body,
    {
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      timeout: 25_000,
    },
  );
  return response.data;
}

function metricNumber(row: any, metricHeaders: any[], name: string) {
  const index = metricHeaders.findIndex((item: any) => item?.name === name);
  if (index < 0) return 0;
  const value = Number(row?.metricValues?.[index]?.value || 0);
  return Number.isFinite(value) ? value : 0;
}

function dimensionValue(row: any, dimensionHeaders: any[], name: string) {
  const index = dimensionHeaders.findIndex((item: any) => item?.name === name);
  return index < 0 ? '' : String(row?.dimensionValues?.[index]?.value || '');
}

function parseSummary(report: any) {
  const row = report?.rows?.[0] || {};
  const headers = report?.metricHeaders || [];
  return {
    sessions: metricNumber(row, headers, 'sessions'),
    totalUsers: metricNumber(row, headers, 'totalUsers'),
    newUsers: metricNumber(row, headers, 'newUsers'),
    engagedSessions: metricNumber(row, headers, 'engagedSessions'),
    engagementRate: metricNumber(row, headers, 'engagementRate'),
    keyEvents: metricNumber(row, headers, 'keyEvents'),
    totalRevenue: metricNumber(row, headers, 'totalRevenue'),
  };
}

function parseDimensionRows(report: any, dimensionName: string, metrics: string[]) {
  const dimensions = report?.dimensionHeaders || [];
  const metricHeaders = report?.metricHeaders || [];
  return (report?.rows || []).map((row: any) => ({
    value: dimensionValue(row, dimensions, dimensionName),
    ...Object.fromEntries(metrics.map((name) => [name, metricNumber(row, metricHeaders, name)])),
  }));
}

export async function registerGoogleAnalyticsRoutes(app: FastifyInstance) {
  app.get('/google-analytics/status', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));
    const clientId = scopeClient(user, query.data.clientId);
    const rows = await prisma.googleAnalyticsConnection.findMany({
      where: { organizationId: user.organizationId!, ...(clientId ? { clientId } : {}) },
      select: {
        id: true, clientId: true, propertyId: true, propertyName: true, status: true,
        scopes: true, tokenExpiresAt: true, lastSyncAt: true, lastError: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return ok({
      configured: configurationReady(),
      redirectUri: googleConfig().redirectUri,
      requiredScope: GOOGLE_ANALYTICS_SCOPE,
      rows,
    });
  });

  app.get('/google-analytics/oauth/start', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const cfg = googleConfig();
    if (!configurationReady()) {
      return reply.code(503).send(fail(
        'GOOGLE_ANALYTICS_CONFIGURATION_REQUIRED',
        'Configure GOOGLE_ANALYTICS_CLIENT_ID e GOOGLE_ANALYTICS_CLIENT_SECRET no EasyPanel.',
      ));
    }
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa para conectar o Google Analytics.'));
    const client = await ensureClient(user, query.data.clientId, reply);
    if (!client) return;

    const state = app.jwt.sign({
      type: 'google_analytics_oauth',
      userId: user.id,
      organizationId: user.organizationId,
      clientId: client.id,
    }, { expiresIn: '10m' });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', cfg.clientId);
    authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_ANALYTICS_SCOPE);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    return ok({ authUrl: authUrl.toString(), scope: GOOGLE_ANALYTICS_SCOPE });
  });

  app.get('/google-analytics/oauth/callback', async (req, reply) => {
    const query = z.object({
      code: z.string().min(1).optional(), state: z.string().min(1).optional(),
      error: z.string().optional(), error_description: z.string().optional(),
    }).safeParse(req.query);
    if (!query.success) return reply.code(400).type('text/html').send(htmlPage('Google Analytics', 'Callback inválido.'));
    if (query.data.error) {
      return reply.code(400).type('text/html').send(htmlPage('Conexão Google cancelada', query.data.error_description || 'A autorização foi cancelada.'));
    }
    if (!query.data.code || !query.data.state) return reply.code(400).type('text/html').send(htmlPage('Google Analytics', 'Código OAuth ausente.'));
    if (!configurationReady()) return reply.code(503).type('text/html').send(htmlPage('Configuração Google ausente', 'Configure as credenciais OAuth do Google Analytics no EasyPanel.'));

    try {
      const state = app.jwt.verify(query.data.state) as { type?: string; userId?: string; organizationId?: string; clientId?: string };
      if (state.type !== 'google_analytics_oauth' || !state.organizationId || !state.clientId) throw new Error('Estado OAuth inválido.');
      const client = await prisma.client.findFirst({ where: { id: state.clientId, organizationId: state.organizationId }, select: { id: true } });
      if (!client) throw new Error('Empresa não encontrada para esta autorização.');

      const cfg = googleConfig();
      const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        code: query.data.code,
        grant_type: 'authorization_code',
      });
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', body, {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        timeout: 15_000,
      });
      const newAccessToken = String(tokenResponse.data?.access_token || '');
      if (!newAccessToken) throw new Error('O Google não retornou token de acesso.');
      const existing = await prisma.googleAnalyticsConnection.findUnique({
        where: { organizationId_clientId: { organizationId: state.organizationId, clientId: state.clientId } },
      });
      const refreshToken = tokenResponse.data?.refresh_token
        ? String(tokenResponse.data.refresh_token)
        : existing?.refreshTokenEncrypted
          ? decrypt(existing.refreshTokenEncrypted)
          : '';
      const expiresIn = Number(tokenResponse.data?.expires_in || 3600);
      const saved = await prisma.googleAnalyticsConnection.upsert({
        where: { organizationId_clientId: { organizationId: state.organizationId, clientId: state.clientId } },
        update: {
          accessTokenEncrypted: encrypt(newAccessToken),
          ...(refreshToken ? { refreshTokenEncrypted: encrypt(refreshToken) } : {}),
          tokenExpiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000),
          scopes: String(tokenResponse.data?.scope || GOOGLE_ANALYTICS_SCOPE),
          status: 'active',
          lastError: null,
        },
        create: {
          organizationId: state.organizationId,
          clientId: state.clientId,
          accessTokenEncrypted: encrypt(newAccessToken),
          refreshTokenEncrypted: refreshToken ? encrypt(refreshToken) : null,
          tokenExpiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000),
          scopes: String(tokenResponse.data?.scope || GOOGLE_ANALYTICS_SCOPE),
          status: 'active',
        },
      });
      await prisma.auditLog.create({
        data: {
          organizationId: state.organizationId, userId: state.userId,
          action: 'GOOGLE_ANALYTICS_CONNECTED', entity: 'GoogleAnalyticsConnection', entityId: saved.id,
          metadataJson: { clientId: state.clientId, refreshTokenAvailable: Boolean(refreshToken) },
        },
      });
      return reply.type('text/html').send(htmlPage(
        'Google Analytics conectado',
        'A conta Google foi autorizada com segurança. Feche esta janela, escolha a propriedade GA4 da empresa no painel e salve.',
      ));
    } catch (error: any) {
      return reply.code(400).type('text/html').send(htmlPage('Falha na conexão Google Analytics', googleErrorMessage(error)));
    }
  });

  app.get('/google-analytics/properties', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa.'));
    const client = await ensureClient(user, query.data.clientId, reply);
    if (!client) return;
    const connection = await prisma.googleAnalyticsConnection.findUnique({
      where: { organizationId_clientId: { organizationId: user.organizationId!, clientId: client.id } },
    });
    if (!connection || connection.status !== 'active') return reply.code(409).send(fail('GOOGLE_ANALYTICS_CONNECTION_REQUIRED', 'Conecte a conta Google desta empresa primeiro.'));
    try {
      const token = await accessToken(connection);
      return ok(await listProperties(token));
    } catch (error: any) {
      const message = googleErrorMessage(error);
      await prisma.googleAnalyticsConnection.update({ where: { id: connection.id }, data: { lastError: message } });
      return reply.code(502).send(fail('GOOGLE_ANALYTICS_PROPERTIES_ERROR', 'Não foi possível listar as propriedades GA4.', { detail: message }));
    }
  });

  app.patch('/google-analytics/property', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid(), propertyId: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Empresa ou propriedade GA4 inválida.'));
    const client = await ensureClient(user, body.data.clientId, reply);
    if (!client) return;
    const connection = await prisma.googleAnalyticsConnection.findUnique({
      where: { organizationId_clientId: { organizationId: user.organizationId!, clientId: client.id } },
    });
    if (!connection || connection.status !== 'active') return reply.code(409).send(fail('GOOGLE_ANALYTICS_CONNECTION_REQUIRED', 'Conecte a conta Google desta empresa primeiro.'));
    try {
      const token = await accessToken(connection);
      const properties = await listProperties(token);
      const property = properties.find((item) => item.propertyId === body.data.propertyId.replace(/^properties\//, ''));
      if (!property) return reply.code(404).send(fail('GOOGLE_ANALYTICS_PROPERTY_NOT_FOUND', 'Esta propriedade GA4 não está disponível para a conta Google conectada.'));
      const updated = await prisma.googleAnalyticsConnection.update({
        where: { id: connection.id },
        data: { propertyId: property.propertyId, propertyName: property.propertyName, lastError: null },
        select: { id: true, clientId: true, propertyId: true, propertyName: true, status: true, updatedAt: true },
      });
      await prisma.auditLog.create({
        data: {
          organizationId: user.organizationId, userId: user.id,
          action: 'GOOGLE_ANALYTICS_PROPERTY_SELECTED', entity: 'GoogleAnalyticsConnection', entityId: connection.id,
          metadataJson: { clientId: client.id, propertyId: property.propertyId, propertyName: property.propertyName },
        },
      });
      return ok(updated, 'Propriedade GA4 vinculada à empresa.');
    } catch (error: any) {
      return reply.code(502).send(fail('GOOGLE_ANALYTICS_PROPERTY_ERROR', 'Não foi possível validar a propriedade GA4.', { detail: googleErrorMessage(error) }));
    }
  });

  app.post('/google-analytics/disconnect', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));
    const client = await ensureClient(user, body.data.clientId, reply);
    if (!client) return;
    const connection = await prisma.googleAnalyticsConnection.findUnique({
      where: { organizationId_clientId: { organizationId: user.organizationId!, clientId: client.id } },
    });
    if (!connection) return ok(null, 'Google Analytics já estava desconectado.');
    await prisma.googleAnalyticsConnection.update({
      where: { id: connection.id },
      data: { accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null, status: 'disconnected' },
    });
    await prisma.auditLog.create({
      data: { organizationId: user.organizationId, userId: user.id, action: 'GOOGLE_ANALYTICS_DISCONNECTED', entity: 'GoogleAnalyticsConnection', entityId: connection.id, metadataJson: { clientId: client.id } },
    });
    return ok(null, 'Google Analytics desconectado. A propriedade selecionada e o histórico de auditoria foram preservados.');
  });

  app.get('/google-analytics/report', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional(), since: dateText, until: dateText }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Empresa ou período inválido.'));
    const client = await ensureClient(user, query.data.clientId, reply);
    if (!client) return;
    if (query.data.since > query.data.until) return reply.code(400).send(fail('VALIDATION', 'A data inicial precisa ser anterior à data final.'));
    const connection = await prisma.googleAnalyticsConnection.findUnique({
      where: { organizationId_clientId: { organizationId: user.organizationId!, clientId: client.id } },
    });
    if (!connection || connection.status !== 'active') return reply.code(409).send(fail('GOOGLE_ANALYTICS_CONNECTION_REQUIRED', 'O Google Analytics desta empresa não está conectado.'));
    if (!connection.propertyId) return reply.code(409).send(fail('GOOGLE_ANALYTICS_PROPERTY_REQUIRED', 'Selecione a propriedade GA4 desta empresa antes de consultar os resultados.'));

    try {
      const token = await accessToken(connection);
      const dateRanges = [{ startDate: query.data.since, endDate: query.data.until }];
      const [summaryReport, dailyReport, channelsReport] = await Promise.all([
        runReport(token, connection.propertyId, {
          dateRanges,
          metrics: ['sessions','totalUsers','newUsers','engagedSessions','engagementRate','keyEvents','totalRevenue'].map((name) => ({ name })),
        }),
        runReport(token, connection.propertyId, {
          dateRanges, dimensions: [{ name: 'date' }],
          metrics: ['sessions','keyEvents','totalRevenue'].map((name) => ({ name })),
          orderBys: [{ dimension: { dimensionName: 'date' } }], limit: '400',
        }),
        runReport(token, connection.propertyId, {
          dateRanges, dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: ['sessions','keyEvents','totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: '100',
        }),
      ]);

      let googleAds: any = { available: true, warning: null, totals: {}, campaigns: [] };
      try {
        const adsReport = await runReport(token, connection.propertyId, {
          dateRanges,
          dimensions: [{ name: 'sessionGoogleAdsCampaignName' }, { name: 'sessionGoogleAdsCustomerId' }],
          metrics: ['sessions','keyEvents','totalRevenue','advertiserAdCost','advertiserAdClicks','advertiserAdImpressions'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'advertiserAdCost' }, desc: true }], limit: '500',
        });
        const campaigns = (adsReport?.rows || []).map((row: any) => {
          const d = adsReport.dimensionHeaders || [];
          const m = adsReport.metricHeaders || [];
          const name = dimensionValue(row, d, 'sessionGoogleAdsCampaignName');
          const cost = metricNumber(row, m, 'advertiserAdCost');
          const clicks = metricNumber(row, m, 'advertiserAdClicks');
          const impressions = metricNumber(row, m, 'advertiserAdImpressions');
          const keyEvents = metricNumber(row, m, 'keyEvents');
          const revenue = metricNumber(row, m, 'totalRevenue');
          return {
            name,
            customerId: dimensionValue(row, d, 'sessionGoogleAdsCustomerId'),
            sessions: metricNumber(row, m, 'sessions'), cost, clicks, impressions, keyEvents, revenue,
            cpc: clicks ? cost / clicks : 0,
            costPerKeyEvent: keyEvents ? cost / keyEvents : 0,
            roas: cost ? revenue / cost : 0,
          };
        }).filter((item: any) => item.name && item.name !== '(not set)');
        const totals = campaigns.reduce((acc: any, row: any) => {
          acc.sessions += row.sessions; acc.cost += row.cost; acc.clicks += row.clicks; acc.impressions += row.impressions;
          acc.keyEvents += row.keyEvents; acc.revenue += row.revenue; return acc;
        }, { sessions: 0, cost: 0, clicks: 0, impressions: 0, keyEvents: 0, revenue: 0 });
        googleAds = {
          available: true, warning: null,
          totals: { ...totals, cpc: totals.clicks ? totals.cost / totals.clicks : 0, costPerKeyEvent: totals.keyEvents ? totals.cost / totals.keyEvents : 0, roas: totals.cost ? totals.revenue / totals.cost : 0 },
          campaigns,
        };
      } catch (error: any) {
        googleAds = {
          available: false,
          warning: 'Os dados do Google Ads não estão disponíveis nesta propriedade GA4. Confirme se a conta Google Ads está vinculada ao Analytics e se há dados de custo no período.',
          detail: process.env.NODE_ENV === 'production' ? undefined : googleErrorMessage(error),
          totals: {}, campaigns: [],
        };
      }

      await prisma.googleAnalyticsConnection.update({
        where: { id: connection.id }, data: { lastSyncAt: new Date(), lastError: null },
      });
      return ok({
        client: { id: client.id, name: client.name },
        property: { id: connection.propertyId, name: connection.propertyName },
        period: { since: query.data.since, until: query.data.until },
        summary: parseSummary(summaryReport),
        daily: parseDimensionRows(dailyReport, 'date', ['sessions','keyEvents','totalRevenue']),
        channels: parseDimensionRows(channelsReport, 'sessionDefaultChannelGroup', ['sessions','keyEvents','totalRevenue']),
        googleAds,
        source: 'Google Analytics Data API (GA4)',
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      const message = googleErrorMessage(error);
      await prisma.googleAnalyticsConnection.update({ where: { id: connection.id }, data: { lastError: message } });
      return reply.code(502).send(fail('GOOGLE_ANALYTICS_REPORT_ERROR', 'Não foi possível consultar os resultados desta propriedade GA4.', { detail: process.env.NODE_ENV === 'production' ? undefined : message }));
    }
  });
}
