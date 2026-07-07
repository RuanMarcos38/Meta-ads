import type { FastifyInstance } from 'fastify';
import { Platform } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRoles } from '../middleware/auth.js';
import { MANAGER_ROLES } from '../services/accessControl.js';
import { requireFeature } from '../services/features.js';
import { syncAdAccountMetrics, syncClientMetrics } from '../services/sync.js';
import { assertTenantAdAccount, assertTenantClient } from '../services/tenantScope.js';

function defaultPeriod() {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 7);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export async function syncRoutes(app: FastifyInstance) {
  app.post('/sync/client/:clientId', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('sync')] }, async (request) => {
    const params = z.object({ clientId: z.string() }).parse(request.params);
    const body = z.object({ from: z.string().optional(), to: z.string().optional(), platform: z.nativeEnum(Platform).optional() }).parse(request.body ?? {});
    await assertTenantClient(request.user!.tenantId, params.clientId);
    const period = defaultPeriod();
    return syncClientMetrics({
      tenantId: request.user!.tenantId,
      clientId: params.clientId,
      platform: body.platform,
      from: body.from || period.from,
      to: body.to || period.to,
      requestedBy: request.user!.sub
    });
  });

  app.post('/sync/ad-account/:adAccountId', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('sync')] }, async (request) => {
    const params = z.object({ adAccountId: z.string() }).parse(request.params);
    const body = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(request.body ?? {});
    await assertTenantAdAccount(request.user!.tenantId, params.adAccountId);
    const period = defaultPeriod();
    return syncAdAccountMetrics({
      tenantId: request.user!.tenantId,
      adAccountId: params.adAccountId,
      from: body.from || period.from,
      to: body.to || period.to,
      requestedBy: request.user!.sub
    });
  });

  app.get('/sync/logs', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('sync')] }, async (request) => {
    const query = z.object({ clientId: z.string().optional(), limit: z.coerce.number().default(50) }).parse(request.query);
    if (query.clientId) await assertTenantClient(request.user!.tenantId, query.clientId);
    const logs = await prisma.syncLog.findMany({
      where: { tenantId: request.user!.tenantId, ...(query.clientId ? { clientId: query.clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit, 200)
    });
    return { logs };
  });

  app.get('/sync/status', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('sync')] }, async (request) => {
    const query = z.object({ clientId: z.string().optional() }).parse(request.query);
    if (query.clientId) await assertTenantClient(request.user!.tenantId, query.clientId);
    const jobs = await prisma.platformSyncJob.findMany({
      where: { tenantId: request.user!.tenantId, ...(query.clientId ? { clientId: query.clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    return { jobs };
  });
}
