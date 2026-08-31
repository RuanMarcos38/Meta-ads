import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';
import { env } from './config/env.js';
import { runSync } from './modules/meta/syncService.js';

const paramsSchema = z.object({ id: z.string().uuid() });
const assignmentSchema = z.object({ isAssigned: z.boolean() });
const RELEASE_VERSION = '2026.08.31.1';

async function assignmentHandler(req: FastifyRequest, reply: FastifyReply) {
  const user = req.user as AuthUser;
  const params = paramsSchema.safeParse(req.params);
  const body = assignmentSchema.safeParse(req.body);

  if (!params.success || !body.success) {
    return reply.code(400).send(fail('VALIDATION', 'Autorização de conta Meta inválida.'));
  }

  const account = await prisma.metaAdAccount.findFirst({
    where: {
      id: params.data.id,
      organizationId: user.organizationId!,
    },
    select: {
      id: true,
      clientId: true,
      accountId: true,
      name: true,
      businessId: true,
      businessName: true,
      isActive: true,
      isAssigned: true,
      connection: {
        select: {
          organizationId: true,
          status: true,
        },
      },
      client: {
        select: {
          metaBusinessId: true,
          metaBusinessName: true,
        },
      },
    },
  });

  if (!account) {
    return reply.code(404).send(fail('META_ACCOUNT_NOT_FOUND', 'Conta Meta não encontrada para esta empresa.'));
  }

  if (account.connection.organizationId !== user.organizationId) {
    return reply.code(403).send(fail('META_CONNECTION_SCOPE_ERROR', 'A conexão Meta desta conta não pertence à organização autenticada.'));
  }

  if (body.data.isAssigned && (!account.isActive || account.connection.status !== 'active')) {
    return reply.code(409).send(fail(
      'META_ACCOUNT_DISCONNECTED',
      'Reconecte a Meta desta empresa antes de autorizar a conta.',
    ));
  }

  if (
    body.data.isAssigned
    && account.client.metaBusinessId
    && account.businessId
    && account.client.metaBusinessId !== account.businessId
  ) {
    return reply.code(409).send(fail(
      'META_ACCOUNT_BUSINESS_MISMATCH',
      `Esta conta pertence à BM ${account.businessName || account.businessId} e não pode alimentar outra empresa.`,
    ));
  }

  const updated = await prisma.metaAdAccount.update({
    where: { id: account.id },
    data: { isAssigned: body.data.isAssigned },
    select: {
      id: true,
      clientId: true,
      accountId: true,
      name: true,
      currency: true,
      businessId: true,
      businessName: true,
      isActive: true,
      isAssigned: true,
    },
  });

  try {
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: body.data.isAssigned
          ? 'ASSIGN_META_ACCOUNT_TO_CLIENT'
          : 'UNASSIGN_META_ACCOUNT_FROM_CLIENT',
        entity: 'MetaAdAccount',
        entityId: updated.id,
        metadataJson: {
          clientId: updated.clientId,
          accountId: updated.accountId,
          method: req.method,
        },
      },
    });
  } catch (auditError) {
    req.log.warn({ auditError, accountId: updated.id }, 'Falha não bloqueante ao registrar auditoria da conta Meta.');
  }

  const shouldStartHistory = body.data.isAssigned && !account.isAssigned && !env.demoMode;
  if (shouldStartHistory) {
    const existingHistory = await prisma.syncJob.findFirst({
      where: {
        organizationId: user.organizationId!,
        clientId: account.clientId,
        type: 'history',
        status: { in: ['running', 'success'] },
      },
      select: { id: true },
    });

    if (!existingHistory) {
      setTimeout(() => {
        void runSync(user.organizationId!, account.clientId, user.id, 'history', { fullHistory: true })
          .catch((historyError) => {
            req.log.error({ historyError, clientId: account.clientId, accountId: account.id }, 'Falha no backfill histórico iniciado pela autorização Meta.');
          });
      }, 0);
    }
  }

  return ok(
    { ...updated, historySyncStarted: shouldStartHistory },
    body.data.isAssigned
      ? 'Conta Meta autorizada. O histórico completo será sincronizado automaticamente.'
      : 'Conta Meta removida do dashboard desta empresa.',
  );
}

export async function registerMetaAccountAssignmentRoutes(app: FastifyInstance) {
  app.get('/meta/account-assignment-capability', async () => ok({
    enabled: true,
    version: RELEASE_VERSION,
    methods: ['POST', 'PATCH'],
  }));

  app.post('/meta/client-accounts/:id/assignment', {
    preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']),
  }, assignmentHandler);
}
