import { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { ok, fail } from './shared/response.js';
import { requireAuth, scopeClient, AuthUser } from './shared/auth.js';
import { env } from './config/env.js';
import { runSync } from './modules/meta/syncService.js';
import { demoSummary, demoCampaigns, demoDaily } from './modules/demo/demoData.js';

const asNumber = (value: unknown) => Number(value ?? 0);

export async function registerRoutes(app: FastifyInstance) {
  // HEALTH
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      return ok({
        status: 'ok',
        database: 'connected',
        schema: env.databaseSchema,
        version: '1.1.0',
        time: new Date().toISOString(),
      });
    } catch {
      return reply.code(503).send(fail('DATABASE_UNAVAILABLE', 'API online, mas o banco de dados não respondeu.'));
    }
  });

  // AUTH
  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados inválidos.'));

    const user = await prisma.user.findUnique({ where: { email: body.data.email.toLowerCase() } });
    if (!user || !user.isActive) {
      return reply.code(401).send(fail('INVALID_CREDENTIALS', 'E-mail ou senha inválidos.'));
    }

    const valid = await argon2.verify(user.passwordHash, body.data.password);
    if (!valid) return reply.code(401).send(fail('INVALID_CREDENTIALS', 'E-mail ou senha inválidos.'));

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await prisma.auditLog.create({
      data: { organizationId: user.organizationId, userId: user.id, action: 'LOGIN', ip: req.ip },
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

    const totals = new Map<string, { spend: number; impressions: number; clicks: number; leads: number }>();
    for (const row of insights) {
      if (!row.campaignId) continue;
      const current = totals.get(row.campaignId) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 };
      current.spend += asNumber(row.spend);
      current.impressions += row.impressions;
      current.clicks += row.clicks;
      current.leads += row.leads;
      totals.set(row.campaignId, current);
    }

    return ok(campaigns.map((campaign) => {
      const metric = totals.get(campaign.metaCampaignId) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 };
      return {
        ...campaign,
        ...metric,
        ctr: metric.impressions ? (metric.clicks / metric.impressions) * 100 : 0,
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
