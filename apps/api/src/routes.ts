import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import axios from 'axios';
import { prisma } from './shared/prisma.js';
import { ok, fail } from './shared/response.js';
import { requireAuth, scopeClient, AuthUser } from './shared/auth.js';
import { verifyPassword } from './shared/password.js';
import { encrypt } from './shared/crypto.js';
import { env } from './config/env.js';
import { runSync } from './modules/meta/syncService.js';
import { MetaAdsService } from './modules/meta/MetaAdsService.js';
import { demoSummary, demoCampaigns, demoDaily } from './modules/demo/demoData.js';

const VERSION = '1.3.0';
const META_OAUTH_SCOPES = ['ads_read', 'business_management'];
const asNumber = (value: unknown) => Number(value ?? 0);

function metaGraphBase() {
  return `https://graph.facebook.com/${env.meta.apiVersion}`;
}

function htmlPage(title: string, message: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:Arial,sans-serif;background:#0f172a;color:#e5e7eb;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:520px;padding:32px;border:1px solid #334155;border-radius:16px;background:#111827}h1{margin:0 0 12px;font-size:24px}p{line-height:1.5;color:#cbd5e1}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

function metaConfigurationReady() {
  return Boolean(env.meta.appId && env.meta.appSecret && env.meta.redirectUri);
}

function metaConfigFailure(reply: any) {
  return reply.code(503).send(fail(
    'META_CONFIGURATION_ERROR',
    'Configure META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no EasyPanel.',
  ));
}

function configurationFailure(reply: any) {
  return reply.code(503).send(fail(
    'CONFIGURATION_ERROR',
    'A API está online, mas existem variáveis inválidas no EasyPanel.',
    { issues: env.configurationErrors },
  ));
}

export async function registerRoutes(app: FastifyInstance) {
  // LIVENESS — não depende de banco, seed ou integrações externas.
  app.get('/live', async () => ok({
    status: 'up',
    service: 'gestao-ads-api',
    version: VERSION,
    time: new Date().toISOString(),
  }));

  app.get('/', async () => ok({
    service: 'gestao-ads-api',
    status: 'online',
    version: VERSION,
    health: '/health',
    liveness: '/live',
  }));

  // READINESS
  app.get('/health', async (_req, reply) => {
    if (env.configurationErrors.length) return configurationFailure(reply);

    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      return ok({
        status: 'ok',
        database: 'connected',
        schema: env.databaseSchema,
        projectRef: env.supabaseProjectRef,
        version: VERSION,
        time: new Date().toISOString(),
      });
    } catch {
      return reply.code(503).send(fail(
        'DATABASE_UNAVAILABLE',
        'A API está online, mas não conseguiu autenticar no banco Supabase.',
        {
          schema: env.databaseSchema,
          projectRef: env.supabaseProjectRef,
          databaseConfigured: Boolean(env.databaseUrl),
        },
      ));
    }
  });

  app.get('/auth/status', async (_req, reply) => {
    if (env.configurationErrors.length) return configurationFailure(reply);

    try {
      const activeUsers = await prisma.user.count({ where: { isActive: true } });
      return ok({
        ready: activeUsers > 0,
        activeUsers,
        schema: env.databaseSchema,
        version: VERSION,
      });
    } catch {
      return reply.code(503).send(fail('DATABASE_UNAVAILABLE', 'A API está online, mas o banco de dados não respondeu.'));
    }
  });

  // AUTH
  app.post('/auth/login', async (req, reply) => {
    if (env.configurationErrors.length) return configurationFailure(reply);

    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados inválidos.'));

    const email = body.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return reply.code(401).send(fail('INVALID_CREDENTIALS', 'E-mail ou senha inválidos.'));
    }

    const password = await verifyPassword(body.data.password, user.passwordHash);
    if (!password.valid) {
      return reply.code(401).send(fail('INVALID_CREDENTIALS', 'E-mail ou senha inválidos.'));
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(password.upgradedHash ? { passwordHash: password.upgradedHash } : {}),
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: 'LOGIN',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        metadataJson: password.upgradedHash ? { legacyPasswordHashUpgraded: true } : undefined,
      },
    });

    const payload: AuthUser = {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId ?? undefined,
      clientId: user.clientId ?? undefined,
    };
    const token = app.jwt.sign(payload, { expiresIn: env.jwtExpiresIn });
    const refresh = app.jwt.sign(payload, {
      expiresIn: env.jwtRefreshExpiresIn,
      key: env.jwtRefreshSecret,
    } as any);

    return ok({
      token,
      refresh,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    });
  });

  app.post('/auth/refresh', async (req, reply) => {
    if (env.configurationErrors.length) return configurationFailure(reply);

    const body = z.object({ refresh: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Refresh token ausente.'));

    try {
      const payload = app.jwt.verify(body.data.refresh, { key: env.jwtRefreshSecret } as any) as AuthUser;
      const user = await prisma.user.findUnique({ where: { id: payload.id } });
      if (!user || !user.isActive) throw new Error('Usuário inválido');

      const nextPayload: AuthUser = {
        id: user.id,
        role: user.role,
        organizationId: user.organizationId ?? undefined,
        clientId: user.clientId ?? undefined,
      };
      const token = app.jwt.sign(nextPayload, { expiresIn: env.jwtExpiresIn });
      return ok({ token });
    } catch {
      return reply.code(401).send(fail('INVALID_REFRESH_TOKEN', 'Sessão expirada. Faça login novamente.'));
    }
  });

  app.get('/auth/me', { preHandler: requireAuth() }, async (req) => {
    const u = req.user as AuthUser;
    const user = await prisma.user.findUnique({
      where: { id: u.id },
      select: { id: true, name: true, email: true, role: true, clientId: true },
    });
    return ok(user);
  });

  app.post('/auth/logout', { preHandler: requireAuth() }, async (req) => {
    const u = req.user as AuthUser;
    await prisma.auditLog.create({ data: { userId: u.id, organizationId: u.organizationId, action: 'LOGOUT' } });
    return ok(null, 'Logout realizado.');
  });

  // CLIENTS
  app.get('/clients', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER']) }, async (req) => {
    const u = req.user as AuthUser;
    const managerClientId = u.role === 'MANAGER' ? scopeClient(u) : undefined;
    const clients = await prisma.client.findMany({
      where: {
        organizationId: u.organizationId!,
        ...(u.role === 'MANAGER' ? { id: managerClientId ?? '__no_assigned_client__' } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return ok(clients);
  });

  app.post('/clients', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const u = req.user as AuthUser;
    const body = z.object({
      name: z.string().min(2),
      companyName: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      segment: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados inválidos.'));

    const client = await prisma.client.create({ data: { ...body.data, organizationId: u.organizationId! } });
    await prisma.auditLog.create({
      data: {
        organizationId: u.organizationId,
        userId: u.id,
        action: 'CREATE_CLIENT',
        entity: 'client',
        entityId: client.id,
      },
    });
    return ok(client, 'Cliente cadastrado com sucesso.');
  });

  // DASHBOARD
  app.get('/dashboard/summary', { preHandler: requireAuth() }, async (req) => {
    const u = req.user as AuthUser;
    const clientId = scopeClient(u, (req.query as any)?.clientId);
    if (env.demoMode) return ok(demoSummary());

    const rows = await prisma.insightDaily.findMany({
      where: {
        organizationId: u.organizationId!,
        ...(clientId ? { clientId } : {}),
        level: 'campaign',
      },
    });

    const sum = rows.reduce((acc, row) => {
      acc.spend += asNumber(row.spend);
      acc.impressions += row.impressions;
      acc.reach += row.reach;
      acc.clicks += row.clicks;
      acc.leads += row.leads;
      acc.conversations += row.conversations;
      return acc;
    }, { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversations: 0 });

    return ok({
      ...sum,
      frequency: sum.reach ? sum.impressions / sum.reach : 0,
      cpm: sum.impressions ? (sum.spend / sum.impressions) * 1000 : 0,
      ctr: sum.impressions ? (sum.clicks / sum.impressions) * 100 : 0,
      cpc: sum.clicks ? sum.spend / sum.clicks : 0,
      costPerLead: sum.leads ? sum.spend / sum.leads : 0,
      costPerConversation: sum.conversations ? sum.spend / sum.conversations : 0,
    });
  });

  app.get('/dashboard/campaigns', { preHandler: requireAuth() }, async (req) => {
    const u = req.user as AuthUser;
    const clientId = scopeClient(u, (req.query as any)?.clientId);
    if (env.demoMode) return ok(demoCampaigns());

    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: u.organizationId!, ...(clientId ? { clientId } : {}) },
      orderBy: { updatedAt: 'desc' },
    });

    const metaCampaignIds = campaigns.map((campaign) => campaign.metaCampaignId);
    const insights = metaCampaignIds.length
      ? await prisma.insightDaily.findMany({
          where: {
            organizationId: u.organizationId!,
            ...(clientId ? { clientId } : {}),
            level: 'campaign',
            campaignId: { in: metaCampaignIds },
          },
        })
      : [];

    const totals = new Map<string, { spend: number; impressions: number; clicks: number; leads: number; conversations: number }>();
    for (const row of insights) {
      if (!row.campaignId) continue;
      const current = totals.get(row.campaignId) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, conversations: 0 };
      current.spend += asNumber(row.spend);
      current.impressions += row.impressions;
      current.clicks += row.clicks;
      current.leads += row.leads;
      current.conversations += row.conversations;
      totals.set(row.campaignId, current);
    }

    return ok(campaigns.map((campaign) => {
      const metric = totals.get(campaign.metaCampaignId) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, conversations: 0 };
      return {
        ...campaign,
        ...metric,
        ctr: metric.impressions ? (metric.clicks / metric.impressions) * 100 : 0,
        cpc: metric.clicks ? metric.spend / metric.clicks : 0,
      };
    }));
  });

  app.get('/dashboard/daily', { preHandler: requireAuth() }, async (req) => {
    const u = req.user as AuthUser;
    const clientId = scopeClient(u, (req.query as any)?.clientId);
    if (env.demoMode) return ok(demoDaily());

    const rows = await prisma.insightDaily.findMany({
      where: {
        organizationId: u.organizationId!,
        ...(clientId ? { clientId } : {}),
        level: 'campaign',
      },
      orderBy: { date: 'asc' },
    });

    const daily = new Map<string, { date: string; spend: number; leads: number }>();
    for (const row of rows) {
      const iso = row.date.toISOString().slice(0, 10);
      const [, month, day] = iso.split('-');
      const current = daily.get(iso) ?? { date: `${day}/${month}`, spend: 0, leads: 0 };
      current.spend += asNumber(row.spend);
      current.leads += row.leads;
      daily.set(iso, current);
    }

    return ok(Array.from(daily.values()));
  });

  app.post('/dashboard/sync', { preHandler: requireAuth() }, async (req, reply) => {
    const u = req.user as AuthUser;
    const clientId = scopeClient(u, (req.body as any)?.clientId);
    if (env.demoMode) return ok({ jobId: 'demo', processed: 0 }, 'Modo demo: dados simulados atualizados.');

    try {
      const result = await runSync(u.organizationId!, clientId, u.id);
      return ok(result, 'Sincronização concluída com sucesso.');
    } catch (error: any) {
      return reply.code(502).send(fail('META_SYNC_ERROR', 'Falha ao sincronizar com a Meta.', {
        detail: env.isProduction ? undefined : error?.message,
      }));
    }
  });

  // META OAUTH
  app.get('/meta/oauth/start', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    if (!metaConfigurationReady()) return metaConfigFailure(reply);

    const u = req.user as AuthUser;
    const query = z.object({ clientId: z.string().min(1) }).safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send(fail('CLIENT_REQUIRED', 'Informe o clientId que receberá a conexão Meta.'));
    }

    const client = await prisma.client.findFirst({
      where: { id: query.data.clientId, organizationId: u.organizationId! },
      select: { id: true },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Cliente não encontrado para este acesso.'));

    const state = app.jwt.sign({
      type: 'meta_oauth',
      userId: u.id,
      organizationId: u.organizationId,
      clientId: client.id,
    }, { expiresIn: '10m' });

    const authUrl = new URL(`https://www.facebook.com/${env.meta.apiVersion}/dialog/oauth`);
    authUrl.searchParams.set('client_id', env.meta.appId);
    authUrl.searchParams.set('redirect_uri', env.meta.redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', META_OAUTH_SCOPES.join(','));

    return ok({ authUrl: authUrl.toString(), scopes: META_OAUTH_SCOPES });
  });

  app.get('/meta/oauth/callback', async (req, reply) => {
    const query = z.object({
      code: z.string().min(1).optional(),
      state: z.string().min(1).optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }).safeParse(req.query);
    if (!query.success) return reply.code(400).type('text/html').send(htmlPage('Meta Ads', 'Callback inválido.'));

    if (query.data.error) {
      return reply.code(400).type('text/html').send(htmlPage(
        'Conexão Meta cancelada',
        query.data.error_description || 'A Meta recusou ou cancelou a autorização.',
      ));
    }

    if (!query.data.code || !query.data.state) {
      return reply.type('text/html').send(htmlPage(
        'Callback Meta ativo',
        'Este endpoint está pronto para receber autorizações do Meta Developers.',
      ));
    }

    if (!metaConfigurationReady()) {
      return reply.code(503).type('text/html').send(htmlPage(
        'Configuração Meta ausente',
        'Configure META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no EasyPanel.',
      ));
    }

    try {
      const state = app.jwt.verify(query.data.state) as {
        type?: string;
        userId?: string;
        organizationId?: string;
        clientId?: string;
      };
      if (state.type !== 'meta_oauth' || !state.organizationId || !state.clientId) {
        throw new Error('Estado OAuth inválido.');
      }

      const shortToken = await axios.get(`${metaGraphBase()}/oauth/access_token`, {
        params: {
          client_id: env.meta.appId,
          client_secret: env.meta.appSecret,
          redirect_uri: env.meta.redirectUri,
          code: query.data.code,
        },
      });

      let tokenPayload = shortToken.data as { access_token: string; expires_in?: number };
      try {
        const longToken = await axios.get(`${metaGraphBase()}/oauth/access_token`, {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: env.meta.appId,
            client_secret: env.meta.appSecret,
            fb_exchange_token: tokenPayload.access_token,
          },
        });
        tokenPayload = longToken.data;
      } catch {
        // Se a troca por token longo falhar, o token curto ainda permite concluir a conexão.
      }

      const tokenExpiresAt = tokenPayload.expires_in
        ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000)
        : undefined;
      const me = await axios.get(`${metaGraphBase()}/me`, {
        params: { fields: 'id,name', access_token: tokenPayload.access_token },
      });

      await prisma.metaConnection.updateMany({
        where: { organizationId: state.organizationId, clientId: state.clientId, status: 'active' },
        data: { status: 'replaced' },
      });
      const connection = await prisma.metaConnection.create({
        data: {
          organizationId: state.organizationId,
          clientId: state.clientId,
          metaUserId: String(me.data.id || ''),
          accessTokenEncrypted: encrypt(tokenPayload.access_token),
          tokenExpiresAt,
          scopes: META_OAUTH_SCOPES.join(','),
          status: 'active',
        },
      });

      const meta = new MetaAdsService(tokenPayload.access_token);
      const accounts = await meta.adAccounts();
      for (const account of accounts) {
        const existing = await prisma.metaAdAccount.findFirst({
          where: {
            organizationId: state.organizationId,
            clientId: state.clientId,
            accountId: String(account.account_id),
          },
        });
        const data = {
          name: account.name,
          currency: account.currency,
          timezone: account.timezone_name,
          accountStatus: account.account_status ? Number(account.account_status) : null,
          connectionId: connection.id,
          isActive: true,
        };
        if (existing) {
          await prisma.metaAdAccount.update({ where: { id: existing.id }, data });
        } else {
          await prisma.metaAdAccount.create({
            data: {
              organizationId: state.organizationId,
              clientId: state.clientId,
              accountId: String(account.account_id),
              ...data,
            },
          });
        }
      }

      await prisma.auditLog.create({
        data: {
          organizationId: state.organizationId,
          userId: state.userId,
          action: 'META_CONNECTED',
          entity: 'MetaConnection',
          entityId: connection.id,
          metadataJson: { accountCount: accounts.length },
        },
      });

      return reply.type('text/html').send(htmlPage(
        'Meta Ads conectado',
        `Conexão salva com sucesso. Contas de anúncio localizadas: ${accounts.length}. Você já pode voltar ao painel e atualizar os dados.`,
      ));
    } catch {
      return reply.code(400).type('text/html').send(htmlPage(
        'Falha na conexão Meta',
        'Não foi possível concluir a autorização. Revise o app no Meta Developers e tente novamente.',
      ));
    }
  });

  // ALERTS
  app.get('/alerts', { preHandler: requireAuth() }, async (req) => {
    const u = req.user as AuthUser;
    const clientId = scopeClient(u, (req.query as any)?.clientId);
    const alerts = await prisma.alert.findMany({
      where: { organizationId: u.organizationId!, ...(clientId ? { clientId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return ok(alerts);
  });

  // AUDIT
  app.get('/audit-logs', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req) => {
    const u = req.user as AuthUser;
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: u.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ok(logs);
  });
}
