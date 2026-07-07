import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export async function logAudit(input: {
  tenantId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      metadata: input.metadata
    }
  });
}

export async function logSync(input: {
  tenantId: string;
  clientId?: string | null;
  platform?: 'META' | 'GOOGLE' | null;
  level?: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.syncLog.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId ?? null,
      platform: input.platform ?? null,
      level: input.level ?? 'info',
      message: input.message,
      metadata: input.metadata
    }
  });
}
