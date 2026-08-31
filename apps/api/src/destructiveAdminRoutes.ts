import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

const adminRoles = ['SUPER_ADMIN', 'AGENCY_ADMIN'] as const;

export async function registerDestructiveAdminRoutes(app: FastifyInstance) {
  app.delete('/workspace/users/:id', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send(fail('VALIDATION', 'Usuário inválido.'));
    if (params.data.id === actor.id) {
      return reply.code(409).send(fail('SELF_DELETE_BLOCKED', 'Você não pode excluir o próprio acesso.'));
    }

    const existing = await prisma.user.findFirst({
      where: { id: params.data.id, organizationId: actor.organizationId! },
      select: { id: true, name: true, email: true, role: true, clientId: true, businessId: true },
    });
    if (!existing) return reply.code(404).send(fail('USER_NOT_FOUND', 'Usuário não encontrado.'));

    if (existing.role === 'SUPER_ADMIN') {
      if (actor.role !== 'SUPER_ADMIN') {
        return reply.code(403).send(fail('FORBIDDEN', 'Somente um Super Admin pode excluir outro Super Admin.'));
      }
      const superAdmins = await prisma.user.count({
        where: { organizationId: actor.organizationId!, role: 'SUPER_ADMIN', isActive: true },
      });
      if (superAdmins <= 1) {
        return reply.code(409).send(fail('LAST_SUPER_ADMIN', 'O último Super Admin da organização não pode ser excluído.'));
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.supportPresence.deleteMany({ where: { userId: existing.id } });
      await tx.supportConversation.updateMany({
        where: { organizationId: actor.organizationId!, assignedToId: existing.id },
        data: { assignedToId: null },
      });
      await tx.user.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          businessId: existing.businessId,
          action: 'DELETE_USER_ACCESS',
          entity: 'User',
          entityId: existing.id,
          metadataJson: {
            deletedUser: {
              name: existing.name,
              email: existing.email,
              role: existing.role,
              clientId: existing.clientId,
              businessId: existing.businessId,
            },
          },
        },
      });
    });

    return ok({ id: existing.id }, 'Usuário excluído com sucesso. O histórico de auditoria foi preservado.');
  });

  app.delete('/workspace/clients/:id', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const actor = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ confirmName: z.string().trim().min(1).max(200) }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send(fail('VALIDATION', 'Confirmação de exclusão da empresa inválida.'));
    }

    const client = await prisma.client.findFirst({
      where: { id: params.data.id, organizationId: actor.organizationId! },
      select: { id: true, name: true, companyName: true, metaBusinessId: true },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));
    if (body.data.confirmName !== client.name) {
      return reply.code(409).send(fail('CONFIRMATION_MISMATCH', 'Digite exatamente o nome da empresa para confirmar a exclusão.'));
    }

    const counts = await prisma.$transaction(async (tx) => {
      const campaigns = await tx.campaign.findMany({
        where: { organizationId: actor.organizationId!, clientId: client.id },
        select: { id: true },
      });
      const campaignIds = campaigns.map((item) => item.id);

      const deletedSupport = await tx.supportConversation.deleteMany({
        where: { organizationId: actor.organizationId!, clientId: client.id },
      });
      await tx.supportPresence.deleteMany({ where: { organizationId: actor.organizationId!, clientId: client.id } });
      const deletedAlerts = await tx.alert.deleteMany({ where: { organizationId: actor.organizationId!, clientId: client.id } });
      const deletedReports = await tx.report.deleteMany({ where: { organizationId: actor.organizationId!, clientId: client.id } });
      const deletedJobs = await tx.syncJob.deleteMany({ where: { organizationId: actor.organizationId!, clientId: client.id } });
      const deletedBreakdowns = await tx.insightBreakdownDaily.deleteMany({ where: { organizationId: actor.organizationId!, clientId: client.id } });
      const deletedInsights = await tx.insightDaily.deleteMany({ where: { organizationId: actor.organizationId!, clientId: client.id } });

      if (campaignIds.length) {
        await tx.ad.deleteMany({ where: { campaignId: { in: campaignIds } } });
        await tx.adSet.deleteMany({ where: { campaignId: { in: campaignIds } } });
      }
      const deletedCampaigns = await tx.campaign.deleteMany({
        where: { organizationId: actor.organizationId!, clientId: client.id },
      });
      const deletedAccounts = await tx.metaAdAccount.deleteMany({
        where: { organizationId: actor.organizationId!, clientId: client.id },
      });
      const deletedManagers = await tx.businessManager.deleteMany({
        where: { organizationId: actor.organizationId!, clientId: client.id },
      });
      const deletedConnections = await tx.metaConnection.deleteMany({
        where: { organizationId: actor.organizationId!, clientId: client.id },
      });
      const deletedUsers = await tx.user.deleteMany({
        where: { organizationId: actor.organizationId!, clientId: client.id },
      });
      await tx.client.delete({ where: { id: client.id } });

      const result = {
        users: deletedUsers.count,
        businessManagers: deletedManagers.count,
        metaAccounts: deletedAccounts.count,
        campaigns: deletedCampaigns.count,
        insights: deletedInsights.count,
        breakdowns: deletedBreakdowns.count,
        syncJobs: deletedJobs.count,
        reports: deletedReports.count,
        alerts: deletedAlerts.count,
        supportConversations: deletedSupport.count,
        metaConnections: deletedConnections.count,
      };

      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.id,
          action: 'DELETE_CLIENT',
          entity: 'Client',
          entityId: client.id,
          metadataJson: {
            deletedClient: {
              name: client.name,
              companyName: client.companyName,
              metaBusinessId: client.metaBusinessId,
            },
            deletedRecords: result,
          },
        },
      });
      return result;
    });

    return ok({ id: client.id, counts }, 'Empresa e dados operacionais vinculados foram excluídos com sucesso.');
  });
}
