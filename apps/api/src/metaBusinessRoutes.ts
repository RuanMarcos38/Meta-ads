import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MetaAdsService, type MetaBusinessDirectoryItem } from './modules/meta/MetaAdsService.js';
import { prisma } from './shared/prisma.js';
import { decrypt } from './shared/crypto.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

async function resolveActiveConnection(organizationId: string, preferredClientId?: string) {
  if (preferredClientId) {
    const preferred = await prisma.metaConnection.findFirst({
      where: { organizationId, clientId: preferredClientId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    });
    if (preferred) return preferred;
  }

  return prisma.metaConnection.findFirst({
    where: { organizationId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  });
}

async function loadDirectory(organizationId: string, preferredClientId?: string) {
  const connection = await resolveActiveConnection(organizationId, preferredClientId);
  if (!connection) return null;

  const token = decrypt(connection.accessTokenEncrypted);
  const meta = new MetaAdsService(token);
  const businesses = await meta.businessDirectory();
  return { connection, businesses };
}

function knownEmails(business: MetaBusinessDirectoryItem) {
  return Array.from(new Set([
    ...business.admins,
    ...business.users,
    ...business.pendingUsers,
  ].map((item) => item.email?.trim().toLowerCase()).filter(Boolean))) as string[];
}

function preferredEmail(business: MetaBusinessDirectoryItem) {
  const adminEmail = business.admins.find((item) => item.email)?.email;
  if (adminEmail) return adminEmail.trim().toLowerCase();
  const activeEmail = business.users.find((item) => item.email)?.email;
  if (activeEmail) return activeEmail.trim().toLowerCase();
  const pendingEmail = business.pendingUsers.find((item) => item.email)?.email;
  return pendingEmail ? pendingEmail.trim().toLowerCase() : null;
}

async function persistAccountBusinessMap(
  organizationId: string,
  clientId: string,
  businesses: MetaBusinessDirectoryItem[],
) {
  let updated = 0;

  for (const business of businesses) {
    const ids = business.adAccounts.map((account) => account.accountId).filter(Boolean);
    if (!ids.length) continue;

    const result = await prisma.metaAdAccount.updateMany({
      where: {
        organizationId,
        clientId,
        accountId: { in: ids },
      },
      data: {
        businessId: business.businessId,
        businessName: business.businessName,
      },
    });
    updated += result.count;
  }

  return updated;
}

export async function registerMetaBusinessRoutes(app: FastifyInstance) {
  app.get('/meta/business-directory', {
    preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']),
  }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida para consultar as BMs.'));

    if (query.data.clientId) {
      const client = await prisma.client.findFirst({
        where: { id: query.data.clientId, organizationId: user.organizationId! },
        select: { id: true },
      });
      if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));
    }

    try {
      const loaded = await loadDirectory(user.organizationId!, query.data.clientId);
      if (!loaded) {
        return reply.code(409).send(fail(
          'META_CONNECTION_REQUIRED',
          'Conecte a Meta em ao menos uma empresa para carregar as Business Managers disponíveis.',
        ));
      }

      const mappedAccounts = query.data.clientId
        ? await persistAccountBusinessMap(user.organizationId!, query.data.clientId, loaded.businesses)
        : 0;

      return ok({
        sourceClientId: loaded.connection.clientId,
        mappedAccounts,
        businesses: loaded.businesses.map((business) => ({
          ...business,
          adminEmails: knownEmails(business),
          preferredAdminEmail: preferredEmail(business),
        })),
      });
    } catch (error: any) {
      return reply.code(502).send(fail(
        'META_BUSINESS_DIRECTORY_ERROR',
        'Não foi possível carregar as Business Managers da Meta. Verifique a permissão business_management e tente novamente.',
        { detail: process.env.NODE_ENV === 'production' ? undefined : error?.response?.data?.error?.message ?? error?.message },
      ));
    }
  });

  app.post('/clients/:id/business-from-meta', {
    preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']),
  }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({
      businessId: z.string().trim().min(2).max(100),
      adminEmail: z.string().email().optional().or(z.literal('')),
    }).safeParse(req.body);

    if (!params.success || !body.success) {
      return reply.code(400).send(fail('VALIDATION', 'Business Manager inválida.'));
    }

    const client = await prisma.client.findFirst({
      where: { id: params.data.id, organizationId: user.organizationId! },
      select: { id: true, name: true },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));

    try {
      const loaded = await loadDirectory(user.organizationId!, client.id);
      if (!loaded) {
        return reply.code(409).send(fail(
          'META_CONNECTION_REQUIRED',
          'Conecte a Meta antes de vincular uma Business Manager.',
        ));
      }

      const business = loaded.businesses.find((item) => item.businessId === body.data.businessId);
      if (!business) {
        return reply.code(404).send(fail(
          'META_BUSINESS_NOT_FOUND',
          'A Business Manager selecionada não está disponível para o usuário Meta conectado.',
        ));
      }

      const returnedEmails = knownEmails(business);
      const requestedEmail = body.data.adminEmail?.trim().toLowerCase() || '';
      const adminEmail = requestedEmail || preferredEmail(business);

      const accountIds = business.adAccounts.map((account) => account.accountId).filter(Boolean);

      const result = await prisma.$transaction(async (tx) => {
        const updatedClient = await tx.client.update({
          where: { id: client.id },
          data: {
            metaBusinessId: business.businessId,
            metaBusinessName: business.businessName,
            metaAdminEmail: adminEmail || null,
          },
        });

        const users = await tx.user.updateMany({
          where: {
            organizationId: user.organizationId!,
            clientId: client.id,
            role: { in: ['CLIENT', 'MANAGER'] },
          },
          data: { businessId: business.businessId },
        });

        const matchingAccounts = accountIds.length
          ? await tx.metaAdAccount.updateMany({
              where: {
                organizationId: user.organizationId!,
                clientId: client.id,
                accountId: { in: accountIds },
              },
              data: {
                businessId: business.businessId,
                businessName: business.businessName,
              },
            })
          : { count: 0 };

        await tx.metaAdAccount.updateMany({
          where: {
            organizationId: user.organizationId!,
            clientId: client.id,
            isAssigned: true,
            NOT: { businessId: business.businessId },
          },
          data: { isAssigned: false },
        });

        await tx.auditLog.create({
          data: {
            organizationId: user.organizationId,
            userId: user.id,
            action: 'LINK_CLIENT_BUSINESS_FROM_META',
            entity: 'Client',
            entityId: client.id,
            metadataJson: {
              businessId: business.businessId,
              businessName: business.businessName,
              adminEmail: adminEmail || null,
              returnedAdminEmails: returnedEmails,
              mappedAccounts: matchingAccounts.count,
              usersUpdated: users.count,
              sourceClientId: loaded.connection.clientId,
            },
          },
        });

        return { updatedClient, mappedAccounts: matchingAccounts.count, usersUpdated: users.count };
      });

      return ok({
        client: result.updatedClient,
        business: {
          businessId: business.businessId,
          businessName: business.businessName,
          adminEmail: adminEmail || null,
          adminEmails: returnedEmails,
          accountCount: business.adAccounts.length,
        },
        mappedAccounts: result.mappedAccounts,
        usersUpdated: result.usersUpdated,
      }, 'Business Manager vinculada a partir dos dados reais da Meta.');
    } catch (error: any) {
      return reply.code(502).send(fail(
        'META_BUSINESS_LINK_ERROR',
        'Não foi possível vincular a Business Manager selecionada.',
        { detail: process.env.NODE_ENV === 'production' ? undefined : error?.response?.data?.error?.message ?? error?.message },
      ));
    }
  });
}
