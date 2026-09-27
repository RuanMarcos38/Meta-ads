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
const businessSelectionsSchema = z.array(z.object({
  businessId: z.string().trim().min(1).max(100),
  accountIds: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
})).min(1).max(50);

const assignmentBody = z.object({
  clientId: z.string().uuid(),
  selections: businessSelectionsSchema,
});

const createClientWithBusinessManagersBody = z.object({
  name: z.string().trim().min(2).max(120),
  companyName: z.string().trim().max(180).optional(),
  document: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(40).optional(),
  segment: z.string().trim().max(120).optional(),
  selections: businessSelectionsSchema,
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

type CachedBusinessManagerRow = {
  metaBusinessId: string;
  name: string;
  adminEmail: string | null;
  status: string;
  updatedAt: Date;
};

type CachedAdAccountRow = {
  accountId: string;
  name: string | null;
  currency: string | null;
  accountStatus: number | null;
  businessId: string | null;
  businessName: string | null;
  updatedAt: Date;
};

export function buildCachedDirectory(
  managers: CachedBusinessManagerRow[],
  accounts: CachedAdAccountRow[],
): MetaBusinessDirectoryItem[] {
  const map = new Map<string, MetaBusinessDirectoryItem>();

  const sortedManagers = [...managers].sort((a, b) => {
    const activeA = a.status === 'active' ? 1 : 0;
    const activeB = b.status === 'active' ? 1 : 0;
    if (activeA !== activeB) return activeB - activeA;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  for (const manager of sortedManagers) {
    const businessId = String(manager.metaBusinessId || '').trim();
    if (!businessId || map.has(businessId)) continue;
    map.set(businessId, {
      businessId,
      businessName: manager.name || `BM ${businessId}`,
      users: [],
      admins: manager.adminEmail ? [{ id: `cached-admin-${businessId}`, email: manager.adminEmail, role: 'ADMIN' }] : [],
      pendingUsers: [],
      adAccounts: [],
    });
  }

  for (const account of [...accounts].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
    const businessId = String(account.businessId || '').trim();
    if (!businessId) continue;
    if (!map.has(businessId)) {
      map.set(businessId, {
        businessId,
        businessName: account.businessName || `BM ${businessId}`,
        users: [],
        admins: [],
        pendingUsers: [],
        adAccounts: [],
      });
    }
    const target = map.get(businessId)!;
    const accountId = normalizedAccountId(account.accountId);
    if (!accountId || target.adAccounts.some((item) => normalizedAccountId(item.accountId) === accountId)) continue;
    target.adAccounts.push({
      accountId,
      name: account.name || undefined,
      currency: account.currency || undefined,
      accountStatus: account.accountStatus,
    });
  }

  return Array.from(map.values())
    .map((business) => ({
      ...business,
      adAccounts: [...business.adAccounts].sort((a, b) => String(a.name || a.accountId).localeCompare(String(b.name || b.accountId), 'pt-BR')),
    }))
    .sort((a, b) => a.businessName.localeCompare(b.businessName, 'pt-BR'));
}

async function loadCachedDirectory(organizationId: string) {
  const [managers, accounts] = await Promise.all([
    prisma.businessManager.findMany({
      where: { organizationId },
      select: { metaBusinessId: true, name: true, adminEmail: true, status: true, updatedAt: true },
    }),
    prisma.metaAdAccount.findMany({
      where: { organizationId, businessId: { not: null } },
      select: { accountId: true, name: true, currency: true, accountStatus: true, businessId: true, businessName: true, updatedAt: true },
    }),
  ]);
  return buildCachedDirectory(managers, accounts);
}

export function chooseDirectoryConnection(
  clientId: string,
  candidates: DirectoryConnectionCandidate[],
): DirectoryConnectionResolution {
  const sorted = [...candidates].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const organizationConnection = sorted.find((item) => item.clientId === null);
  if (organizationConnection) {
    return { connection: organizationConnection, source: 'organization', sourceClientId: null };
  }

  const own = sorted.find((item) => item.clientId === clientId);
  if (own) return { connection: own, source: 'client', sourceClientId: own.clientId };

  if (!sorted.length) return { connection: null, source: 'none', sourceClientId: null };

  // Compatibilidade com conexões legadas por empresa. Elas só podem ser
  // compartilhadas quando todas pertencem ao mesmo usuário Meta.
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
    ? 'Existem conexões Meta legadas diferentes. Conecte a ferramenta à Meta em Integrações para usar uma única conexão global e separar as BMs por empresa.'
    : 'A ferramenta ainda não possui uma conexão Meta global ativa. Conecte a Meta em Integrações e tente novamente.';
}

async function loadDirectory(organizationId: string, clientId: string) {
  const resolution = await resolveDirectoryConnection(organizationId, clientId);
  if (!resolution.connection) {
    return {
      resolution,
      directory: [] as MetaBusinessDirectoryItem[],
      directorySource: 'none' as const,
      warning: null as string | null,
    };
  }

  const cachedDirectory = await loadCachedDirectory(organizationId);
  const meta = new MetaAdsService(decrypt(resolution.connection.accessTokenEncrypted));

  try {
    const directory = await meta.businessDirectory();
    if (directory.length) {
      return {
        resolution,
        directory,
        directorySource: 'meta' as const,
        warning: null as string | null,
      };
    }
    if (cachedDirectory.length) {
      return {
        resolution,
        directory: cachedDirectory,
        directorySource: 'cache' as const,
        warning: 'A Meta não retornou a lista neste momento. Exibindo as BMs já descobertas e salvas na ferramenta.',
      };
    }
    return {
      resolution,
      directory,
      directorySource: 'meta' as const,
      warning: null as string | null,
    };
  } catch (error: any) {
    if (cachedDirectory.length) {
      return {
        resolution,
        directory: cachedDirectory,
        directorySource: 'cache' as const,
        warning: error?.response?.data?.error?.message
          ? `Meta temporariamente indisponível: ${error.response.data.error.message}. Exibindo as BMs salvas na ferramenta.`
          : 'Meta temporariamente indisponível. Exibindo as BMs salvas na ferramenta para você selecionar sem perder o vínculo.',
      };
    }
    throw error;
  }
}

async function discoveryPayload(organizationId: string, clientId: string, directory: MetaBusinessDirectoryItem[]) {
  const [managers, accounts, activeAssignments] = await Promise.all([
    prisma.businessManager.findMany({
      where: { organizationId, clientId },
      select: { metaBusinessId: true, status: true },
    }),
    prisma.metaAdAccount.findMany({
      where: { organizationId, clientId },
      select: { accountId: true, businessId: true, isAssigned: true },
    }),
    prisma.businessManager.findMany({
      where: {
        organizationId,
        status: 'active',
        metaBusinessId: { in: directory.map((business) => business.businessId) },
      },
      select: {
        metaBusinessId: true,
        clientId: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  const activeBusinesses = new Set(managers.filter((item) => item.status === 'active').map((item) => item.metaBusinessId));
  const assignedAccounts = new Set(accounts.filter((item) => item.isAssigned).map((item) => `${item.businessId || ''}:${normalizedAccountId(item.accountId)}`));
  const assignmentByBusiness = new Map(activeAssignments.map((item) => [item.metaBusinessId, item]));

  return directory.map((business) => {
    const assignment = assignmentByBusiness.get(business.businessId);
    const assignedElsewhere = Boolean(assignment && assignment.clientId !== clientId);
    return {
      businessId: business.businessId,
      businessName: business.businessName,
      adminEmail: preferredEmail(business),
      selected: activeBusinesses.has(business.businessId),
      available: !assignedElsewhere,
      assignedClientId: assignedElsewhere ? assignment?.clientId || null : null,
      assignedClientName: assignedElsewhere ? assignment?.client.name || null : null,
      accountCount: business.adAccounts.length,
      accounts: business.adAccounts.map((account) => ({
        accountId: normalizedAccountId(account.accountId),
        name: account.name || `Conta ${normalizedAccountId(account.accountId)}`,
        currency: account.currency || null,
        accountStatus: account.accountStatus ?? null,
        selected: assignedAccounts.has(`${business.businessId}:${normalizedAccountId(account.accountId)}`),
      })),
    };
  });
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

  const activeConflicts = selectedIds.size ? await prisma.businessManager.findMany({
    where: {
      organizationId: input.organizationId,
      clientId: { not: input.clientId },
      status: 'active',
      metaBusinessId: { in: Array.from(selectedIds) },
    },
    select: {
      metaBusinessId: true,
      name: true,
      client: { select: { name: true } },
    },
  }) : [];

  if (activeConflicts.length) {
    const first = activeConflicts[0];
    throw new Error(`A BM ${first.name} (${first.metaBusinessId}) já está vinculada à empresa ${first.client.name}. Remova o vínculo anterior antes de associá-la a outra empresa.`);
  }

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

async function newClientDiscoveryPayload(organizationId: string, directory: MetaBusinessDirectoryItem[]) {
  const activeAssignments = await prisma.businessManager.findMany({
    where: {
      organizationId,
      status: 'active',
      metaBusinessId: { in: directory.map((business) => business.businessId) },
    },
    select: {
      metaBusinessId: true,
      clientId: true,
      client: { select: { name: true } },
    },
  });
  const assignmentByBusiness = new Map(activeAssignments.map((item) => [item.metaBusinessId, item]));

  return directory.map((business) => {
    const assignment = assignmentByBusiness.get(business.businessId);
    return {
      businessId: business.businessId,
      businessName: business.businessName,
      adminEmail: preferredEmail(business),
      selected: false,
      available: !assignment,
      assignedClientId: assignment?.clientId || null,
      assignedClientName: assignment?.client.name || null,
      accountCount: business.adAccounts.length,
      accounts: business.adAccounts.map((account) => ({
        accountId: normalizedAccountId(account.accountId),
        name: account.name || `Conta ${normalizedAccountId(account.accountId)}`,
        currency: account.currency || null,
        accountStatus: account.accountStatus ?? null,
        selected: false,
      })),
    };
  });
}

export async function registerBusinessManagerDirectoryRoutes(app: FastifyInstance) {
  app.post('/workspace/business-managers/discover-for-new-client', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    try {
      const { resolution, directory, directorySource, warning } = await loadDirectory(user.organizationId!, '__new_client__');
      if (!resolution.connection) return reply.code(409).send(fail('META_CONNECTION_REQUIRED', connectionError(resolution)));
      return ok({
        businesses: await newClientDiscoveryPayload(user.organizationId!, directory),
        connectionSource: resolution.source,
        sourceClientId: resolution.sourceClientId,
        directorySource,
        warning,
      }, warning || 'Selecione obrigatoriamente uma ou mais BMs antes de concluir o cadastro da empresa.');
    } catch (error: any) {
      return reply.code(502).send(fail(
        'META_BUSINESS_DIRECTORY_FAILED',
        error?.response?.data?.error?.message || error?.message || 'Não foi possível consultar as BMs na Meta.',
      ));
    }
  });

  app.post('/workspace/clients/create-with-business-managers', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = createClientWithBusinessManagersBody.safeParse(req.body ?? {});
    if (!body.success) {
      return reply.code(400).send(fail('BUSINESS_REQUIRED', 'O cadastro da empresa exige pelo menos uma Business Manager válida.'));
    }

    let createdClient: { id: string; name: string } | null = null;
    try {
      const { resolution, directory, directorySource, warning } = await loadDirectory(user.organizationId!, '__new_client__');
      if (!resolution.connection) return reply.code(409).send(fail('META_CONNECTION_REQUIRED', connectionError(resolution)));

      const selectedIds = new Set(body.data.selections.map((item) => item.businessId));
      const knownIds = new Set(directory.map((item) => item.businessId));
      for (const businessId of selectedIds) {
        if (!knownIds.has(businessId)) {
          return reply.code(409).send(fail('BUSINESS_ASSIGNMENT_FAILED', 'Uma ou mais BMs selecionadas não estão disponíveis na conexão Meta atual.'));
        }
      }

      createdClient = await prisma.client.create({
        data: {
          organizationId: user.organizationId!,
          name: body.data.name,
          companyName: body.data.companyName || null,
          document: body.data.document || null,
          email: body.data.email?.toLowerCase() || null,
          phone: body.data.phone || null,
          segment: body.data.segment || null,
        },
        select: { id: true, name: true },
      });

      let result;
      try {
        result = await persistSelectedDirectory({
          organizationId: user.organizationId!,
          clientId: createdClient.id,
          connection: resolution.connection,
          directory,
          selections: body.data.selections.map((item) => ({
            businessId: item.businessId,
            accountIds: item.accountIds.map(normalizedAccountId),
          })),
        });
      } catch (error) {
        await prisma.client.delete({ where: { id: createdClient.id } }).catch(() => undefined);
        createdClient = null;
        throw error;
      }

      const client = await prisma.client.findUnique({ where: { id: createdClient.id } });
      await prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'CREATE_CLIENT_WITH_BUSINESS_MANAGERS',
          entity: 'Client',
          entityId: createdClient.id,
          metadataJson: {
            selections: body.data.selections,
            selectedBusinesses: result.selectedBusinesses,
            assignedAccounts: result.assignedAccounts,
            connectionSource: resolution.source,
            sourceClientId: resolution.sourceClientId,
            directorySource,
            warning,
          } as Prisma.InputJsonValue,
        },
      }).catch(() => undefined);

      return ok({
        client,
        selectedBusinesses: result.selectedBusinesses,
        mappedAccounts: result.mappedAccounts,
        assignedAccounts: result.assignedAccounts,
      }, result.selectedBusinesses > 1
        ? 'Empresa cadastrada com múltiplas BMs. O acesso fica restrito às BMs vinculadas ao perfil desta empresa.'
        : 'Empresa cadastrada com a BM obrigatória vinculada ao perfil.');
    } catch (error: any) {
      return reply.code(409).send(fail(
        'CLIENT_BUSINESS_CREATE_FAILED',
        error?.message || 'Não foi possível concluir o cadastro da empresa com as BMs selecionadas.',
      ));
    }
  });

  app.post('/workspace/business-managers/discover-from-meta', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = clientBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Selecione uma empresa válida.'));
    const client = await getClient(user.organizationId!, body.data.clientId);
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));

    try {
      const { resolution, directory, directorySource, warning } = await loadDirectory(user.organizationId!, client.id);
      if (!resolution.connection) return reply.code(409).send(fail('META_CONNECTION_REQUIRED', connectionError(resolution)));
      const businesses = await discoveryPayload(user.organizationId!, client.id, directory);
      return ok({
        client,
        businesses,
        connectionSource: resolution.source,
        sourceClientId: resolution.sourceClientId,
        directorySource,
        warning,
      }, warning || 'Selecione somente as BMs e contas de anúncios que pertencem a esta empresa.');
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
      const { resolution, directory, directorySource, warning } = await loadDirectory(user.organizationId!, client.id);
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
          metadataJson: { selections: body.data.selections, ...result, directorySource, warning } as Prisma.InputJsonValue,
        },
      });
      return ok({ ...result, directorySource, warning }, warning
        || (result.selectedBusinesses > 1
          ? 'BMs agrupadas na mesma empresa. Dashboard e relatórios permanecem separados pelo seletor de BM e conta.'
          : 'BM vinculada à empresa com as contas autorizadas selecionadas.'));
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
