import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

export async function registerMetaDisconnectRoutes(app: FastifyInstance) {
  app.post('/meta/disconnect', {
    preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']),
  }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid() }).safeParse(req.body);

    if (!body.success) {
      return reply.code(400).send(fail('VALIDATION', 'Cliente inválido para desconectar da Meta.'));
    }

    const client = await prisma.client.findFirst({
      where: {
        id: body.data.clientId,
        organizationId: user.organizationId!,
      },
      select: { id: true },
    });

    if (!client) {
      return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Cliente não encontrado para este acesso.'));
    }

    const activeConnections = await prisma.metaConnection.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId: client.id,
        status: 'active',
      },
      select: { id: true },
    });

    const connectionIds = activeConnections.map((item) => item.id);

    const result = await prisma.$transaction(async (tx) => {
      const connections = await tx.metaConnection.updateMany({
        where: {
          organizationId: user.organizationId!,
          clientId: client.id,
          status: 'active',
        },
        data: { status: 'disconnected' },
      });

      const accounts = await tx.metaAdAccount.updateMany({
        where: {
          organizationId: user.organizationId!,
          clientId: client.id,
          isActive: true,
          ...(connectionIds.length ? { connectionId: { in: connectionIds } } : {}),
        },
        data: { isActive: false },
      });

      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'META_DISCONNECTED',
          entity: 'Client',
          entityId: client.id,
          metadataJson: {
            connectionsDisabled: connections.count,
            accountsDisabled: accounts.count,
            historyPreserved: true,
          },
        },
      });

      return {
        connectionsDisabled: connections.count,
        accountsDisabled: accounts.count,
      };
    });

    return ok({
      clientId: client.id,
      disconnected: true,
      ...result,
      historyPreserved: true,
    }, 'Meta Ads desconectado. O histórico de campanhas e métricas foi preservado.');
  });
}
