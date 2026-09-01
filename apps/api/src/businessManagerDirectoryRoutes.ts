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

const clientBody = z.object({ clientId: z.string().uuid() });
const assignmentBody = z.object({
  clientId: z.string().uuid(),
  selections: z.array(z.object({
    businessId: z.string().trim().min(1).max(100),
    accountIds: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
  })).min(1).max(50),
});

function preferredEmail(business: MetaBusinessDirectoryItem) {
  return business.admins.find((item) => item.email)?.email
    || business.users.find((item) => item.email)?.email
    || business.pendingUsers.find((item) => item.email)?.email
    || null;
}

function normalizedAccountId(value: string) {
  return String(value || '').replace(/^act_/, '').trim();
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

async function getClient(organizationId: string, clientId: string) {
  return prisma.client.findFirst({
    where: { id: clientId, organizationId },
    select: { id: true, name: true, phone: true, metaBusinessId: true },
  });
}

function connectionError(resolution: DirectoryConnectionResolution) {
  return resolution.source === 'ambiguous'
    ? 'Existem diferentes usuários Meta conectados nesta organização. Conecte a Meta diretamente a esta empresa para listar somente as BMs corretas.'
    : 'Nenhuma conexão Meta ativa foi encontrada. Conecte a Meta em Integrações e tente novamente.';
}

async function loadDirectory(organizationId: string, clientId: string) {
  const resolution = await resolveDirectoryConnection(organizationId, clientId);
  if (!resolution.connection) return { resolution, directory: [] as MetaBusinessDirectoryItem[] };
  const meta = new MetaAdsService(decrypt(resolution.connection.accessTokenEncrypted));
  const directory = await meta.businessDirectory();
  return { resolution, directory };
}

async function discoveryPayload(organizationId: string, clientId: string, directory: MetaBusinessDirectoryItem[]) {
  const [managers, accounts] = await Promise.all([
    prisma.businessManager.findMany({
      where: { organizationId, clientId },
      select: { metaBusinessId: true, status: true },
    }),
    prisma.metaAdAccount.findMany({
      where: { organizationId, clientId },
      select: { accountId: true, businessId: true, isAssigned: true },
    }),
  ]);
  const activeBusinesses = new Set(managers.filter((item) => item.status === 'active').map((item) => item.metaBusinessId));
  const assignedAccounts = new Set(accounts.filter((item) => item.isAssigned).map((item) => `${item.businessId || ''}:${normalizedAccountId(item.accountId)}`));

  return directory.map((business) => ({
    businessId: business.businessId,
    businessName: business.businessName,
    adminEmail: preferredEmail(business),
    selected: activeBusinesses.has(business.businessId),
    accountCount: business.adAccounts.length,
    accounts: business.adAccounts.map((account) => ({
      accountId: normalizedAccountId(account.accountId),
      name: account.name || `Conta ${normalizedAccountId(account.accountId)}`,
      currency: account.currency || null,
      accountStatus: account.accountStatus ?? null,
      selected: assignedAccounts.has(`${business.businessId}:${normalizedAccountId(account.accountId)}`),
    })),
  }));
}

async function persistSelectedDirectory(input: {
  organizationId: string;
  clientId: string;
  connection: DirectoryConnectionCandidate;
  directory: MetaBusinessDirectoryItem[];
  selections: Array<{ businessId: string; accountIds: string[] }>;
}) {
  const selectionMap = new Map(input.selections.map((item) => [item.businessId, new Set(item.accountIds.map(normalizedAccountId))]));
  const selectedDirectory = input.directory.filter((item) => selectionMap.has(item.businessId));
  const selectedIds = new Set(selectedDirectory.map((item) => item.businessId));

  if (selectedDirectory.length !== selectionMap.size) {
    throw new Error('Uma ou mais BMs selecionadas não pertencem à conexão Meta disponível para esta empresa.');
  }

  for (const business of selectedDirectory) {
    const allowedAccounts = new Set(business.adAccounts.map((account) => normalizedAccountId(account.accountId)));
    for (const accountId of selectionMap.get(business.businessId) || []) {
      if (!allowedAccounts.has(accountId)) throw new Error(`A conta ${accountId} não pertence à BM ${business.businessName}.`);
    }
  }

  return prisma.$transaction(async (tx) => {
    const previousManagers = await tx.businessManager.findMany({
      where: { organizationId: input.organizationId, clientId: input.clientId },
      select: { metaBusinessId: true },
    });
    const previousIds = previousManagers.map((item) => item.metaBusinessId);

    if (previousIds.length) {
      await tx.businessManager.updateMany({
        where: { organizationId: input.organizationId, clientId: input.clientId },
        data: { status: 'inactive' },
      });
      await tx.metaAdAccount.updateMany({
        where: { organizationId: input.organizationId, clientId: input.clientId },
        data: { isAssigned: false },
      });
    }

    let mappedAccounts = 0;
    let assignedAccounts = 0;

    for (const business of selectedDirectory) {
      const selectedAccountIds = selectionMap.get(business.businessId) || new Set<string>();
      const manager = await tx.businessManager.upsert({
        where: {
          organizationId_clientId_metaBusinessId: {
            organizationId: input.organizationId,
            clientId: input.clientId,
            metaBusinessId: business.businessId,
          },
        },
        update: {
          name: business.businessName,
          adminEmail: preferredEmail(business),
          status: 'active',
          connectionStatus: 'connected',
          tokenStatus: input.connection.tokenExpiresAt && input.connection.tokenExpiresAt < new Date() ? 'expired' : 'valid',
          lastSyncAt: new Date(),
          lastError: null,
        },
        create: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          metaBusinessId: business.businessId,
          name: business.businessName,
          adminEmail: preferredEmail(business),
          status: 'active',
          connectionStatus: 'connected',
          tokenStatus: input.connection.tokenExpiresAt && input.connection.tokenExpiresAt < new Date() ? 'expired' : 'valid',
          lastSyncAt: new Date(),
        },
      });

      for (const account of business.adAccounts) {
        const accountId = normalizedAccountId(account.accountId);
        const isAssigned = selectedAccountIds.has(accountId);
        const existing = await tx.metaAdAccount.findFirst({
          where: { organizationId: input.organizationId, clientId: input.clientId, accountId },
          select: { id: true },
        });
        const data = {
          connectionId: input.connection.id,
          businessManagerId: manager.id,
          businessId: business.businessId,
          businessName: business.businessName,
          name: account.name || null,
          currency: account.currency || null,
          accountStatus: account.accountStatus ?? null,
          isActive: true,
          isAssigned,
        };
        if (existing) await tx.metaAdAccount.update({ where: { id: existing.id }, data });
        else await tx.metaAdAccount.create({ data: { organizationId: input.organizationId, clientId: input.clientId, accountId, ...data } });
        mappedAccounts += 1;
        if (isAssigned) assignedAccounts += 1;
      }
    }

    for (const previousId of previousIds) {
      if (selectedIds.has(previousId)) continue;
      await tx.metaAdAccount.updateMany({
        where: { organizationId: input.organizationId, clientId: input.clientId, businessId: previousId },
        data: { isAssigned: false },
      });
    }

    const primary = selectedDirectory[0];
    await tx.client.update({
      where: { id: input.clientId },
      data: {
        metaBusinessId: primary.businessId,
        metaBusinessName: primary.businessName,
        metaAdminEmail: preferredEmail(primary),
      },
    });

    return { selectedBusinesses: selectedDirectory.length, mappedAccounts, assignedAccounts };
  });
}

async function refreshExistingSelection(input: {
  organizationId: string;
  clientId: string;
  connection: DirectoryConnectionCandidate;
  directory: MetaBusinessDirectoryItem[];
}) {
  const managers = await prisma.businessManager.findMany({
    where: { organizationId: input.organizationId, clientId: input.clientId, status: 'active' },
    select: { metaBusinessId: true },
  });
  const selectedIds = new Set(managers.map((item) => item.metaBusinessId));
  if (!selectedIds.size) return { businesses: 0, mappedAccounts: 0, selectionRequired: true };

  const selectedDirectory = input.directory.filter((item) => selectedIds.has(item.businessId));
  let mappedAccounts = 0;

  for (const business of selectedDirectory) {
    const manager = await prisma.businessManager.upsert({
      where: {
        organizationId_clientId_metaBusinessId: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          metaBusinessId: business.businessId,
        },
      },
      update: {
        name: business.businessName,
        adminEmail: preferredEmail(business),
        status: 'active',
        connectionStatus: 'connected',
        tokenStatus: input.connection.tokenExpiresAt && input.connection.tokenExpiresAt < new Date() ? 'expired' : 'valid',
        lastSyncAt: new Date(),
        lastError: null,
      },
      create: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        metaBusinessId: business.businessId,
        name: business.businessName,
        adminEmail: preferredEmail(business),
        status: 'active',
        connectionStatus: 'connected',
        tokenStatus: input.connection.tokenExpiresAt && input.connection.tokenExpiresAt < new Date() ? 'expired' : 'valid',
        lastSyncAt: new Date(),
      },
    });

    for (const account of business.adAccounts) {
      const accountId = normalizedAccountId(account.accountId);
      const existing = await prisma.metaAdAccount.findFirst({
        where: { organizationId: input.organizationId, clientId: input.clientId, accountId },
        select: { id: true, isAssigned: true },
      });
      const data = {
        connectionId: input.connection.id,
        businessManagerId: manager.id,
        businessId: business.businessId,
        businessName: business.businessName,
        name: account.name || null,
        currency: account.currency || null,
        accountStatus: account.accountStatus ?? null,
        isActive: true,
      };
      if (existing) await prisma.metaAdAccount.update({ where: { id: existing.id }, data });
      else await prisma.metaAdAccount.create({ data: { organizationId: input.organizationId, clientId: input.clientId, accountId, isAssigned: false, ...data } });
      mappedAccounts += 1;
    }
  }

  return { businesses: selectedDirectory.length, mappedAccounts, selectionRequired: false };
}

export async function registerBusinessManagerDirectoryRoutes(app: FastifyInstance) {
  app.post('/workspace/business-managers/discover-from-meta', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = clientBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Selecione uma empresa válida.'));
    const client = await getClient(user.organizationId!, body.data.clientId);
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));

    try {
      const { resolution, directory } = await loadDirectory(user.organizationId!, client.id);
      if (!resolution.connection) return reply.code(409).send(fail('META_CONNECTION_REQUIRED', connectionError(resolution)));
      const businesses = await discoveryPayload(user.organizationId!, client.id, directory);
      return ok({ client, businesses, connectionSource: resolution.source, sourceClientId: resolution.sourceClientId }, 'Selecione somente as BMs e contas de anúncios que pertencem a esta empresa.');
    } catch (error: any) {
      return reply.code(502).send(fail('META_BUSINESS_DIRECTORY_FAILED', error?.response?.data?.error?.message || error?.message || 'Não foi possível consultar as BMs na Meta.'));
    }
  });

  app.post('/workspace/business-managers/assign-from-meta', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = assignmentBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Selecione pelo menos uma BM e informe somente contas válidas.'));
    const client = await getClient(user.organizationId!, body.data.clientId);
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));

    try {
      const { resolution, directory } = await loadDirectory(user.organizationId!, client.id);
      if (!resolution.connection) return reply.code(409).send(fail('META_CONNECTION_REQUIRED', connectionError(resolution)));
      const result = await persistSelectedDirectory({
        organizationId: user.organizationId!,
        clientId: client.id,
        connection: resolution.connection,
        directory,
        selections: body.data.selections.map((item) => ({ businessId: item.businessId, accountIds: item.accountIds.map(normalizedAccountId) })),
      });
      await prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'ASSIGN_COMPANY_BUSINESS_MANAGERS',
          entity: 'Client',
          entityId: client.id,
          metadataJson: { selections: body.data.selections, ...result } as Prisma.InputJsonValue,
        },
      });
      return ok(result, result.selectedBusinesses > 1
        ? 'BMs agrupadas na mesma empresa. Dashboard e relatórios permanecem separados pelo seletor de BM e conta.'
        : 'BM vinculada à empresa com as contas autorizadas selecionadas.');
    } catch (error: any) {
      return reply.code(409).send(fail('BUSINESS_ASSIGNMENT_FAILED', error?.message || 'Não foi possível vincular as BMs desta empresa.'));
    }
  });

  // Compatibilidade com as telas existentes: esta rota agora somente atualiza BMs que já foram
  // explicitamente selecionadas para a empresa. Para uma empresa nova, ela não importa todas as BMs.
  app.post('/workspace/business-managers/import-from-meta', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));

    const clients = await prisma.client.findMany({
      where: { organizationId: user.organizationId!, ...(body.data.clientId ? { id: body.data.clientId } : {}) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const results: Array<Record<string, unknown>> = [];

    for (const client of clients) {
      const resolution = await resolveDirectoryConnection(user.organizationId!, client.id);
      if (!resolution.connection) {
        results.push({ clientId: client.id, name: client.name, ok: false, businesses: 0, mappedAccounts: 0, selectionRequired: true, connectionSource: resolution.source, error: connectionError(resolution) });
        continue;
      }
      try {
        const meta = new MetaAdsService(decrypt(resolution.connection.accessTokenEncrypted));
        const directory = await meta.businessDirectory();
        const refreshed = await refreshExistingSelection({ organizationId: user.organizationId!, clientId: client.id, connection: resolution.connection, directory });
        results.push({ clientId: client.id, name: client.name, ok: true, ...refreshed, connectionSource: resolution.source, sourceClientId: resolution.sourceClientId });
      } catch (error: any) {
        const message = error?.response?.data?.error?.message || error?.message || 'Falha ao consultar Business Managers na Meta.';
        await prisma.businessManager.updateMany({ where: { organizationId: user.organizationId!, clientId: client.id, status: 'active' }, data: { lastError: message } });
        results.push({ clientId: client.id, name: client.name, ok: false, businesses: 0, mappedAccounts: 0, connectionSource: resolution.source, sourceClientId: resolution.sourceClientId, error: message });
      }
    }

    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: 'REFRESH_SELECTED_BUSINESS_DIRECTORY_FROM_META',
        entity: 'BusinessManager',
        metadataJson: { results } as Prisma.InputJsonValue,
      },
    });

    const successCount = results.filter((item) => item.ok === true).length;
    if (!successCount && results.length) {
      const firstError = String(results.find((item) => item.error)?.error || 'Não foi possível consultar as Business Managers na Meta.');
      return reply.code(502).send(fail('META_BUSINESS_DIRECTORY_FAILED', firstError, { results }));
    }
    return ok(results, 'Somente as BMs previamente vinculadas foram atualizadas. Empresas novas exigem seleção explícita.');
  });
}
