import type { FastifyInstance } from 'fastify';
import { Platform, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRoles, resolveClientScope } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';

const adAccountSchema = z.object({
  clientId: z.string(),
  platform: z.nativeEnum(Platform),
  externalAccountId: z.string().min(2),
  accountName: z.string().min(2),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  status: z.string().optional()
});

export async function adAccountRoutes(app: FastifyInstance) {
  app.get('/ad-accounts', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ clientId: z.string().optional(), platform: z.nativeEnum(Platform).optional() }).parse(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    const accounts = await prisma.adAccount.findMany({
      where: {
        tenantId: request.user!.tenantId,
        ...(clientId ? { clientId } : {}),
        ...(query.platform ? { platform: query.platform } : {})
      },
      orderBy: { createdAt: 'desc' }
    });
    return { accounts };
  });

  app.post('/ad-accounts', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request, reply) => {
    const body = adAccountSchema.parse(request.body);
    const client = await prisma.client.findFirst({ where: { id: body.clientId, tenantId: request.user!.tenantId } });
    if (!client) return reply.code(404).send({ message: 'Cliente nao encontrado.' });
    const account = await prisma.adAccount.upsert({
      where: { platform_externalAccountId_clientId: { platform: body.platform, externalAccountId: body.externalAccountId, clientId: body.clientId } },
      create: { tenantId: request.user!.tenantId, ...body, status: body.status ?? 'active' },
      update: { accountName: body.accountName, currency: body.currency, timezone: body.timezone, status: body.status ?? 'active' }
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'ad-account.upsert', entity: 'ad_account', entityId: account.id });
    return { account };
  });

  app.patch('/ad-accounts/:id', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = adAccountSchema.partial().parse(request.body);
    const existing = await prisma.adAccount.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Conta de anuncio nao encontrada.' });
    const account = await prisma.adAccount.update({ where: { id: existing.id }, data: body });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'ad-account.update', entity: 'ad_account', entityId: account.id });
    return { account };
  });

  app.delete('/ad-accounts/:id', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.adAccount.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Conta de anuncio nao encontrada.' });
    const account = await prisma.adAccount.update({ where: { id: existing.id }, data: { status: 'inactive' } });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'ad-account.deactivate', entity: 'ad_account', entityId: account.id });
    return { account };
  });
}
