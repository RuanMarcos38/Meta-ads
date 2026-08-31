import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { ok, fail } from './shared/response.js';
import { decrypt } from './shared/crypto.js';
import { MetaAdsService, type MetaBusinessDirectoryItem } from './modules/meta/MetaAdsService.js';

const adminRoles = ['SUPER_ADMIN', 'AGENCY_ADMIN'] as const;

function preferredEmail(business: MetaBusinessDirectoryItem) {
  return business.admins.find((item) => item.email)?.email
    || business.users.find((item) => item.email)?.email
    || business.pendingUsers.find((item) => item.email)?.email
    || null;
}

export async function registerBusinessManagerDirectoryRoutes(app: FastifyInstance) {
  app.post('/workspace/business-managers/import-from-meta', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));

    const clients = await prisma.client.findMany({
      where: {
        organizationId: user.organizationId!,
        ...(body.data.clientId ? { id: body.data.clientId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const results: Array<Record<string, unknown>> = [];

    for (const client of clients) {
      const connection = await prisma.metaConnection.findFirst({
        where: { organizationId: user.organizationId!, clientId: client.id, status: 'active' },
        orderBy: { updatedAt: 'desc' },
      });

      if (!connection) {
        results.push({ clientId: client.id, name: client.name, ok: false, businesses: 0, createdAccounts: 0, updatedAccounts: 0, error: 'Meta não conectada para esta empresa.' });
        continue;
      }

      try {
        const meta = new MetaAdsService(decrypt(connection.accessTokenEncrypted));
        const businesses = await meta.businessDirectory();
        let createdAccounts = 0;
        let updatedAccounts = 0;
        let mappedAccounts = 0;

        for (const business of businesses) {
          const manager = await prisma.businessManager.upsert({
            where: {
              organizationId_clientId_metaBusinessId: {
                organizationId: user.organizationId!,
                clientId: client.id,
                metaBusinessId: business.businessId,
              },
            },
            update: {
              name: business.businessName,
              adminEmail: preferredEmail(business),
              status: 'active',
              connectionStatus: 'connected',
              tokenStatus: connection.tokenExpiresAt && connection.tokenExpiresAt < new Date() ? 'expired' : 'valid',
              lastSyncAt: new Date(),
              lastError: null,
            },
            create: {
              organizationId: user.organizationId!,
              clientId: client.id,
              metaBusinessId: business.businessId,
              name: business.businessName,
              adminEmail: preferredEmail(business),
              status: 'active',
              connectionStatus: 'connected',
              tokenStatus: connection.tokenExpiresAt && connection.tokenExpiresAt < new Date() ? 'expired' : 'valid',
              lastSyncAt: new Date(),
            },
          });

          for (const account of business.adAccounts) {
            const existing = await prisma.metaAdAccount.findFirst({
              where: {
                organizationId: user.organizationId!,
                clientId: client.id,
                accountId: account.accountId,
              },
              select: { id: true },
            });

            if (existing) {
              await prisma.metaAdAccount.update({
                where: { id: existing.id },
                data: {
                  connectionId: connection.id,
                  businessManagerId: manager.id,
                  businessId: business.businessId,
                  businessName: business.businessName,
                  name: account.name || undefined,
                  currency: account.currency || undefined,
                  accountStatus: account.accountStatus ?? undefined,
                  isActive: true,
                },
              });
              updatedAccounts += 1;
            } else {
              await prisma.metaAdAccount.create({
                data: {
                  organizationId: user.organizationId!,
                  clientId: client.id,
                  connectionId: connection.id,
                  businessManagerId: manager.id,
                  businessId: business.businessId,
                  businessName: business.businessName,
                  accountId: account.accountId,
                  name: account.name || null,
                  currency: account.currency || null,
                  accountStatus: account.accountStatus ?? null,
                  isActive: true,
                  isAssigned: false,
                },
              });
              createdAccounts += 1;
            }
            mappedAccounts += 1;
          }
        }

        results.push({
          clientId: client.id,
          name: client.name,
          ok: true,
          businesses: businesses.length,
          mappedAccounts,
          createdAccounts,
          updatedAccounts,
        });
      } catch (error: any) {
        const message = error?.response?.data?.error?.message || error?.message || 'Falha ao consultar Business Managers na Meta.';
        await prisma.businessManager.updateMany({
          where: { organizationId: user.organizationId!, clientId: client.id },
          data: { lastError: message },
        });
        results.push({ clientId: client.id, name: client.name, ok: false, businesses: 0, createdAccounts: 0, updatedAccounts: 0, error: message });
      }
    }

    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: 'IMPORT_BUSINESS_DIRECTORY_FROM_META',
        entity: 'BusinessManager',
        metadataJson: { results } as Prisma.InputJsonValue,
      },
    });

    const successCount = results.filter((item) => item.ok === true).length;
    if (!successCount && results.length) {
      return reply.code(502).send(fail('META_BUSINESS_DIRECTORY_FAILED', 'Não foi possível consultar as Business Managers na Meta.', { results }));
    }

    return ok(results, 'Business Managers e contas Meta atualizadas pelo Gerenciador de Anúncios.');
  });
}
