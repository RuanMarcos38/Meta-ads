import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';
import { prisma } from './shared/prisma.js';
import { aiStatusForOrganization, refreshCampaignHealth } from './modules/ai/campaignAgent.js';

const adminRoles = ['SUPER_ADMIN', 'AGENCY_ADMIN'] as const;

export async function registerAiRoutes(app: FastifyInstance) {
  app.get('/ai/status', { preHandler: requireAuth() }, async (req) => {
    const user = req.user as AuthUser;
    return ok(await aiStatusForOrganization(user.organizationId!));
  });

  app.get('/ai/campaign-health', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({
      clientId: z.string().uuid().optional(),
      businessId: z.string().trim().max(100).optional(),
    }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Escopo da análise inválido.'));

    const clientId = scopeClient(user, query.data.clientId, reply);
    if (!clientId) return;
    const rows = await prisma.aiCampaignHealth.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId,
        ...(query.data.businessId ? { businessId: query.data.businessId } : {}),
      },
      orderBy: [{ score: 'asc' }, { campaignName: 'asc' }],
    });
    return ok(rows);
  });

  app.post('/ai/analyze/now', { preHandler: requireAuth([...adminRoles]) }, async (req) => {
    const user = req.user as AuthUser;
    const processed = await refreshCampaignHealth(user.organizationId!);
    return ok({ processed }, 'Análise das campanhas atualizada.');
  });
}
