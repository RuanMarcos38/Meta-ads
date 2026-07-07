import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const KNOWN_FEATURES = ['integrations', 'reports', 'sync'] as const;

export async function isFeatureEnabled(tenantId: string, featureName: string) {
  const feature = await prisma.featureFlag.findUnique({
    where: { tenantId_featureName: { tenantId, featureName } },
    select: { enabled: true }
  });
  return feature?.enabled ?? true;
}

export async function listTenantFeatures(tenantId: string) {
  const flags = await prisma.featureFlag.findMany({
    where: { tenantId },
    orderBy: { featureName: 'asc' }
  });
  const byName = new Map(flags.map((flag) => [flag.featureName, flag]));
  const knownFlags = KNOWN_FEATURES.map((featureName) => {
    const flag = byName.get(featureName);
    return {
      id: flag?.id ?? null,
      tenantId,
      featureName,
      enabled: flag?.enabled ?? true,
      createdAt: flag?.createdAt ?? null,
      updatedAt: flag?.updatedAt ?? null
    };
  });
  const customFlags = flags.filter((flag) => !KNOWN_FEATURES.includes(flag.featureName as (typeof KNOWN_FEATURES)[number]));
  return [...knownFlags, ...customFlags];
}

export function requireFeature(featureName: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) await requireAuth(request, reply);
    if (reply.sent) return;
    const enabled = await isFeatureEnabled(request.user!.tenantId, featureName);
    if (!enabled) return reply.code(403).send({ message: `Funcionalidade ${featureName} desativada para esta empresa.` });
  };
}
