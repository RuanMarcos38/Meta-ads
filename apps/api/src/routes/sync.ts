import type { FastifyInstance } from 'fastify';
import { Platform, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRoles } from '../middleware/auth.js';
import { syncAdAccountMetrics, syncClientMetrics } from '../services/sync.js';

function defaultPeriod() {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 7);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export async function syncRoutes(app: FastifyInstance) {
  app.post('/sync/client/:clientId', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request) => {
    const params = z.object({ clientId: z.string() }).parse(request.params);
    const body = z.object({ from: z.string().optional(), to: z.string().optional(), platform: z.nativeEnum(Platform).optional() }).parse(request.body ?? {});
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

  app.post('/sync/ad-account/:adAccountId', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request) => {
    const params = z.object({ adAccountId: z.string() }).parse(request.params);
    const body = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(request.body ?? {});
    const period = defaultPeriod();
    return syncAdAccountMetrics({
      tenantId: request.user!.tenantId,
      adAccountId: params.adAccountId,
      from: body.from || period.from,
      to: body.to || period.to,
      requestedBy: request.user!.sub
    });
  });

  app.get('/sync/logs', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request) => {
    const query = z.object({ clientId: z.string().optional(), limit: z.coerce.number().default(50) }).parse(request.query);
    const logs = await prisma.syncLog.findMany({
      where: { tenantId: request.user!.tenantId, ...(query.clientId ? { clientId: query.clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit, 200)
    });
    return { logs };
  });

  app.get('/sync/status', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request) => {
    const query = z.object({ clientId: z.string().optional() }).parse(request.query);
    const jobs = await prisma.platformSyncJob.findMany({
      where: { tenantId: request.user!.tenantId, ...(query.clientId ? { clientId: query.clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    return { jobs };
  });
}
