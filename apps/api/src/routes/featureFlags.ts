import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { ADMIN_ROLES } from '../services/accessControl.js';
import { listTenantFeatures } from '../services/features.js';
import { logAudit } from '../services/audit.js';

const featureNameSchema = z.string().min(2).max(80).regex(/^[a-z0-9_.-]+$/);

export async function featureFlagRoutes(app: FastifyInstance) {
  app.get('/feature-flags', { preHandler: requireAuth }, async (request) => {
    return { flags: await listTenantFeatures(request.user!.tenantId) };
  });

  app.put('/feature-flags/:featureName', { preHandler: requireRoles(ADMIN_ROLES) }, async (request) => {
    const params = z.object({ featureName: featureNameSchema }).parse(request.params);
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    const flag = await prisma.featureFlag.upsert({
      where: { tenantId_featureName: { tenantId: request.user!.tenantId, featureName: params.featureName } },
      create: { tenantId: request.user!.tenantId, featureName: params.featureName, enabled: body.enabled },
      update: { enabled: body.enabled }
    });
    await logAudit({
      tenantId: request.user!.tenantId,
      userId: request.user!.sub,
      action: 'feature-flag.update',
      entity: 'feature_flag',
      entityId: flag.id,
      metadata: { featureName: flag.featureName, enabled: flag.enabled }
    });
    return { flag };
  });
}
