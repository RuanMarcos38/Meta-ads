import type { FastifyInstance } from 'fastify';
import { IntegrationStatus, Platform, SyncStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, resolveClientScope } from '../middleware/auth.js';
import { requireFeature } from '../services/features.js';
import { getCampaigns, getDailyMetrics, getDashboardHealth, getDashboardSummary, getPlatformDistribution, getTopCampaigns } from '../services/metrics.js';
import { syncClientMetrics } from '../services/sync.js';

function defaultPeriod() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 7);
  return { from, to };
}

function parseQuery(query: unknown) {
  const period = defaultPeriod();
  const parsed = z.object({
    clientId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    platform: z.nativeEnum(Platform).optional(),
    limit: z.coerce.number().optional()
  }).parse(query);
  return {
    ...parsed,
    from: parsed.from ? new Date(`${parsed.from}T00:00:00.000Z`) : period.from,
    to: parsed.to ? new Date(`${parsed.to}T23:59:59.999Z`) : period.to
  };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/summary', { preHandler: requireAuth }, async (request) => {
    const query = parseQuery(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    return getDashboardSummary({ tenantId: request.user!.tenantId, clientId, from: query.from, to: query.to, platform: query.platform });
  });

  app.get('/dashboard/live', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ clientId: z.string().optional() }).parse(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    const scope = { tenantId: request.user!.tenantId, ...(clientId ? { clientId } : {}) };
    const [clients, adAccounts, integrations, runningJobs, errorJobs, lastLog, lastMetric] = await Promise.all([
      prisma.client.count({ where: { tenantId: request.user!.tenantId, ...(clientId ? { id: clientId } : {}) } }),
      prisma.adAccount.count({ where: scope }),
      prisma.integration.count({ where: { ...scope, status: IntegrationStatus.CONNECTED } }),
      prisma.platformSyncJob.count({ where: { ...scope, status: SyncStatus.RUNNING } }),
      prisma.platformSyncJob.count({ where: { ...scope, status: SyncStatus.ERROR } }),
      prisma.syncLog.findFirst({ where: scope, orderBy: { createdAt: 'desc' }, select: { level: true, message: true, platform: true, createdAt: true } }),
      prisma.campaignDailyMetric.findFirst({ where: scope, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true, platform: true } })
    ]);
    return {
      ok: true,
      live: true,
      serverTime: new Date().toISOString(),
      clientId: clientId || null,
      database: 'online',
      counts: { clients, adAccounts, integrations, runningJobs, errorJobs },
      lastLog,
      lastMetric,
      message: runningJobs > 0 ? 'Sincronizacao em andamento.' : 'Painel online.'
    };
  });

  app.get('/dashboard/daily', { preHandler: requireAuth }, async (request) => {
    const query = parseQuery(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    return getDailyMetrics({ tenantId: request.user!.tenantId, clientId, from: query.from, to: query.to, platform: query.platform });
  });

  app.get('/dashboard/campaigns', { preHandler: requireAuth }, async (request) => {
    const query = parseQuery(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    return getCampaigns({ tenantId: request.user!.tenantId, clientId, from: query.from, to: query.to, platform: query.platform });
  });

  app.get('/dashboard/platform-distribution', { preHandler: requireAuth }, async (request) => {
    const query = parseQuery(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    return getPlatformDistribution({ tenantId: request.user!.tenantId, clientId, from: query.from, to: query.to });
  });

  app.get('/dashboard/top-campaigns', { preHandler: requireAuth }, async (request) => {
    const query = parseQuery(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    return getTopCampaigns({ tenantId: request.user!.tenantId, clientId, from: query.from, to: query.to, platform: query.platform, limit: query.limit });
  });

  app.get('/dashboard/health', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ clientId: z.string().optional() }).parse(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    return getDashboardHealth({ tenantId: request.user!.tenantId, clientId });
  });

  app.post('/dashboard/sync', { preHandler: [requireAuth, requireFeature('sync')] }, async (request, reply) => {
    const body = z.object({
      clientId: z.string().optional(),
      platform: z.nativeEnum(Platform).optional(),
      from: z.string().optional(),
      to: z.string().optional()
    }).parse(request.body);
    const clientId = await resolveClientScope(request, body.clientId);
    if (!clientId) return reply.code(400).send({ message: 'Informe clientId para sincronizar.' });
    const period = defaultPeriod();
    return syncClientMetrics({
      tenantId: request.user!.tenantId,
      clientId: clientId!,
      platform: body.platform,
      from: body.from || period.from.toISOString().slice(0, 10),
      to: body.to || period.toISOString?.() || period.to.toISOString().slice(0, 10),
      requestedBy: request.user!.sub
    });
  });
}
