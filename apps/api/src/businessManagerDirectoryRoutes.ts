import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { ok, fail } from './shared/response.js';
import { decrypt } from './shared/crypto.js';
import { MetaAdsService, type MetaBusinessDirectoryItem } from './modules/meta/MetaAdsService.js';

const adminRoles = ['SUPER_ADMIN', 'AGENCY_ADMIN'] as const;

type DirectoryConnectionCandidate = {
  id: string;
  clientId: string | null;
  metaUserId: string | null;
  accessTokenEncrypted: string;
  tokenExpiresAt: Date | null;
  scopes: string | null;
  updatedAt: Date;
};

type DirectoryConnectionResolution =
  | { connection: DirectoryConnectionCandidate; source: 'client' | 'organization'; sourceClientId: string | null }
  | { connection: null; source: 'none' | 'ambiguous'; sourceClientId: null };

function preferredEmail(business: MetaBusinessDirectoryItem) {
  return business.admins.find((item) => item.email)?.email
    || business.users.find((item) => item.email)?.email
    || business.pendingUsers.find((item) => item.email)?.email
    || null;
}

export function chooseDirectoryConnection(
  clientId: string,
  candidates: DirectoryConnectionCandidate[],
): DirectoryConnectionResolution {
  const sorted = [...candidates].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const own = sorted.find((item) => item.clientId === clientId);
  if (own) return { connection: own, source: 'client', sourceClientId: own.clientId };

  if (!sorted.length) return { connection: null, source: 'none', sourceClientId: null };

  const metaUsers = new Set(sorted.map((item) => String(item.metaUserId || '').trim()).filter(Boolean));
  const canShareSafely = metaUsers.size === 1 || (metaUsers.size === 0 && sorted.length === 1);
  if (!canShareSafely) return { connection: null, source: 'ambiguous', sourceClientId: null };

  const shared = sorted[0];
  return { connection: shared, source: 'organization', sourceClientId: shared.clientId };
}

async function resolveDirectoryConnection(organizationId: string, clientId: string) {
  const candidates = await prisma.metaConnection.findMany({
    where: { organizationId, status: 'active' },
    select: {
      id: true,
      clientId: true,
      metaUserId: true,
      accessTokenEncrypted: true,
      tokenExpiresAt: true,
      scopes: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
  return chooseDirectoryConnection(clientId, candidates);
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
      const resolution = await resolveDirectoryConnection(user.organizationId!, client.id);
      const connection = resolution.connection;

      if (!connection) {
        const error = resolution.source === 'ambiguous'
          ? 'Existem diferentes usuários Meta conectados nesta organização. Conecte a Meta diretamente a esta empresa para listar apenas as BMs corretas.'
          : 'Nenhuma conexão Meta ativa foi encontrada. Conecte a Meta em Integrações e tente novamente.';
        results.push({
          clientId: client.id,
          name: client.name,
          ok: false,
          businesses: 0,
          createdAccounts: 0,
          updatedAccounts: 0,
          connectionSource: resolution.source,
          error,
        });
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
          connectionSource: resolution.source,
          sourceClientId: resolution.sourceClientId,
        });
      } catch (error: any) {
        const message = error?.response?.data?.error?.message || error?.message || 'Falha ao consultar Business Managers na Meta.';
        await prisma.businessManager.updateMany({
          where: { organizationId: user.organizationId!, clientId: client.id },
          data: { lastError: message },
        });
        results.push({
          clientId: client.id,
          name: client.name,
          ok: false,
          businesses: 0,
          createdAccounts: 0,
          updatedAccounts: 0,
          connectionSource: resolution.source,
          sourceClientId: resolution.sourceClientId,
          error: message,
        });
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
      const firstError = String(results.find((item) => item.error)?.error || 'Não foi possível consultar as Business Managers na Meta.');
      return reply.code(502).send(fail('META_BUSINESS_DIRECTORY_FAILED', firstError, { results }));
    }

    return ok(results, 'Business Managers e contas Meta atualizadas pelo Gerenciador de Anúncios.');
  });
}
