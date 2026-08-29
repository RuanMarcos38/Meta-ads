import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';
import { runSync } from './modules/meta/syncService.js';
import { hashPassword } from './shared/password.js';

const asNumber = (value: unknown) => Number(value ?? 0);
const restrictedRoles = new Set(['CLIENT', 'MANAGER']);

const scopeSchema = z.object({
  clientId: z.string().uuid().optional(),
  businessId: z.string().trim().min(1).max(100).optional(),
  adAccountId: z.string().uuid().optional(),
});

type ScopeInput = z.infer<typeof scopeSchema>;

type ResolvedScope = {
  clientId: string;
  accountIds: string[];
};

async function resolveScope(
  user: AuthUser,
  input: ScopeInput,
  reply: FastifyReply,
): Promise<ResolvedScope | null> {
  const clientId = scopeClient(user, input.clientId);

  if (!clientId) {
    reply.code(restrictedRoles.has(user.role) ? 403 : 400).send(fail(
      restrictedRoles.has(user.role) ? 'CLIENT_SCOPE_REQUIRED' : 'CLIENT_REQUIRED',
      restrictedRoles.has(user.role)
        ? 'Este usuário precisa estar vinculado a uma empresa.'
        : 'Selecione uma empresa para consultar o dashboard.',
    ));
    return null;
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: user.organizationId! },
    select: { id: true },
  });

  if (!client) {
    reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para este acesso.'));
    return null;
  }

  const accounts = await prisma.metaAdAccount.findMany({
    where: {
      organizationId: user.organizationId!,
      clientId,
      isAssigned: true,
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.adAccountId ? { id: input.adAccountId } : {}),
    },
    select: { id: true },
  });

  if (input.adAccountId && accounts.length === 0) {
    reply.code(404).send(fail('META_ACCOUNT_NOT_ASSIGNED', 'Esta conta Meta não está autorizada para a empresa selecionada.'));
    return null;
  }

  return { clientId, accountIds: accounts.map((account) => account.id) };
}

function insightWhere(user: AuthUser, scope: ResolvedScope) {
  return {
    organizationId: user.organizationId!,
    clientId: scope.clientId,
    level: 'campaign' as const,
    adAccountId: { in: scope.accountIds },
  };
}

export async function registerTenantRoutes(app: FastifyInstance) {
  app.get('/dashboard/context', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const requested = scopeSchema.pick({ clientId: true }).safeParse(req.query);
    if (!requested.success) return reply.code(400).send(fail('VALIDATION', 'Filtro de empresa inválido.'));

    const tenantLocked = restrictedRoles.has(user.role);
    const forcedClientId = tenantLocked ? user.clientId : requested.data.clientId;
    if (tenantLocked && !forcedClientId) {
      return reply.code(403).send(fail('CLIENT_SCOPE_REQUIRED', 'Este usuário ainda não está vinculado a uma empresa.'));
    }

    const clients = await prisma.client.findMany({
      where: {
        organizationId: user.organizationId!,
        ...(forcedClientId ? { id: forcedClientId } : {}),
      },
      select: { id: true, name: true, companyName: true, status: true },
      orderBy: { name: 'asc' },
    });

    const clientIds = clients.map((client) => client.id);
    const accounts = clientIds.length
      ? await prisma.metaAdAccount.findMany({
          where: {
            organizationId: user.organizationId!,
            clientId: { in: clientIds },
            ...(tenantLocked ? { isAssigned: true } : {}),
          },
          select: {
            id: true,
            clientId: true,
            accountId: true,
            name: true,
            currency: true,
            timezone: true,
            accountStatus: true,
            businessId: true,
            businessName: true,
            isActive: true,
            isAssigned: true,
          },
          orderBy: [{ businessName: 'asc' }, { name: 'asc' }],
        })
      : [];

    const businessesByKey = new Map<string, { id: string; name: string; clientId: string }>();
    for (const account of accounts) {
      if (!account.businessId) continue;
      const key = `${account.clientId}:${account.businessId}`;
      if (!businessesByKey.has(key)) {
        businessesByKey.set(key, {
          id: account.businessId,
          name: account.businessName || `BM ${account.businessId}`,
          clientId: account.clientId,
        });
      }
    }

    return ok({
      selectedClientId: forcedClientId ?? null,
      clients,
      businesses: Array.from(businessesByKey.values()),
      accounts,
      role: user.role,
      tenantLocked,
    });
  });

  app.get('/dashboard/scoped/summary', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = scopeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Filtros inválidos.'));
    const scope = await resolveScope(user, parsed.data, reply);
    if (!scope) return;

    const rows = await prisma.insightDaily.findMany({ where: insightWhere(user, scope) });
    const sum = rows.reduce((acc, row) => {
      acc.spend += asNumber(row.spend);
      acc.impressions += row.impressions;
      acc.reach += row.reach;
      acc.clicks += row.clicks;
      acc.leads += row.leads;
      acc.conversations += row.conversations;
      return acc;
    }, { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversations: 0 });

    return ok({
      ...sum,
      frequency: sum.reach ? sum.impressions / sum.reach : 0,
      cpm: sum.impressions ? (sum.spend / sum.impressions) * 1000 : 0,
      ctr: sum.impressions ? (sum.clicks / sum.impressions) * 100 : 0,
      cpc: sum.clicks ? sum.spend / sum.clicks : 0,
      costPerLead: sum.leads ? sum.spend / sum.leads : 0,
      costPerConversation: sum.conversations ? sum.spend / sum.conversations : 0,
    });
  });

  app.get('/dashboard/scoped/campaigns', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = scopeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Filtros inválidos.'));
    const scope = await resolveScope(user, parsed.data, reply);
    if (!scope) return;

    const campaigns = await prisma.campaign.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId: scope.clientId,
        adAccountId: { in: scope.accountIds },
      },
      include: {
        adAccount: {
          select: {
            id: true,
            accountId: true,
            name: true,
            businessId: true,
            businessName: true,
            currency: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const metaCampaignIds = campaigns.map((campaign) => campaign.metaCampaignId);
    const insights = metaCampaignIds.length
      ? await prisma.insightDaily.findMany({
          where: {
            ...insightWhere(user, scope),
            campaignId: { in: metaCampaignIds },
          },
        })
      : [];

    const totals = new Map<string, { spend: number; impressions: number; reach: number; clicks: number; leads: number; conversations: number }>();
    for (const row of insights) {
      if (!row.campaignId) continue;
      const current = totals.get(row.campaignId) ?? { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversations: 0 };
      current.spend += asNumber(row.spend);
      current.impressions += row.impressions;
      current.reach += row.reach;
      current.clicks += row.clicks;
      current.leads += row.leads;
      current.conversations += row.conversations;
      totals.set(row.campaignId, current);
    }

    return ok(campaigns.map((campaign) => {
      const metric = totals.get(campaign.metaCampaignId) ?? { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversations: 0 };
      return {
        ...campaign,
        ...metric,
        ctr: metric.impressions ? (metric.clicks / metric.impressions) * 100 : 0,
        cpc: metric.clicks ? metric.spend / metric.clicks : 0,
        cpm: metric.impressions ? (metric.spend / metric.impressions) * 1000 : 0,
      };
    }));
  });

  app.get('/dashboard/scoped/daily', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = scopeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Filtros inválidos.'));
    const scope = await resolveScope(user, parsed.data, reply);
    if (!scope) return;

    const rows = await prisma.insightDaily.findMany({
      where: insightWhere(user, scope),
      orderBy: { date: 'asc' },
    });

    const daily = new Map<string, { date: string; spend: number; leads: number; conversations: number }>();
    for (const row of rows) {
      const iso = row.date.toISOString().slice(0, 10);
      const [, month, day] = iso.split('-');
      const current = daily.get(iso) ?? { date: `${day}/${month}`, spend: 0, leads: 0, conversations: 0 };
      current.spend += asNumber(row.spend);
      current.leads += row.leads;
      current.conversations += row.conversations;
      daily.set(iso, current);
    }

    return ok(Array.from(daily.values()));
  });

  app.post('/dashboard/scoped/sync', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida para sincronização.'));

    const clientId = scopeClient(user, body.data.clientId);
    if (!clientId) {
      return reply.code(restrictedRoles.has(user.role) ? 403 : 400).send(fail(
        restrictedRoles.has(user.role) ? 'CLIENT_SCOPE_REQUIRED' : 'CLIENT_REQUIRED',
        'Selecione uma empresa para sincronizar.',
      ));
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId! },
      select: { id: true },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para sincronização.'));

    const assignedAccounts = await prisma.metaAdAccount.count({
      where: { organizationId: user.organizationId!, clientId, isActive: true, isAssigned: true },
    });
    if (!assignedAccounts) {
      return reply.code(409).send(fail('NO_ASSIGNED_META_ACCOUNTS', 'Selecione ao menos uma conta Meta para esta empresa antes de sincronizar.'));
    }

    try {
      const result = await runSync(user.organizationId!, clientId, user.id);
      return ok(result, 'Sincronização da empresa concluída com sucesso.');
    } catch {
      return reply.code(502).send(fail('META_SYNC_ERROR', 'Falha ao sincronizar esta empresa com a Meta.'));
    }
  });

  app.patch('/meta/client-accounts/:id/assignment', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ isAssigned: z.boolean() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(fail('VALIDATION', 'Vinculação de conta inválida.'));

    const account = await prisma.metaAdAccount.findFirst({
      where: { id: params.data.id, organizationId: user.organizationId! },
      select: { id: true, clientId: true, isActive: true, name: true, accountId: true },
    });
    if (!account) return reply.code(404).send(fail('META_ACCOUNT_NOT_FOUND', 'Conta Meta não encontrada.'));
    if (body.data.isAssigned && !account.isActive) {
      return reply.code(409).send(fail('META_ACCOUNT_DISCONNECTED', 'Reconecte a Meta antes de vincular esta conta.'));
    }

    const updated = await prisma.metaAdAccount.update({
      where: { id: account.id },
      data: { isAssigned: body.data.isAssigned },
      select: {
        id: true,
        clientId: true,
        accountId: true,
        name: true,
        businessId: true,
        businessName: true,
        isActive: true,
        isAssigned: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: body.data.isAssigned ? 'ASSIGN_META_ACCOUNT_TO_CLIENT' : 'UNASSIGN_META_ACCOUNT_FROM_CLIENT',
        entity: 'MetaAdAccount',
        entityId: updated.id,
        metadataJson: { clientId: updated.clientId, accountId: updated.accountId },
      },
    });

    return ok(updated, body.data.isAssigned ? 'Conta Meta vinculada à empresa.' : 'Conta Meta removida do escopo da empresa.');
  });

  app.post('/meta/client-disconnect', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida para desconexão.'));

    const client = await prisma.client.findFirst({
      where: { id: body.data.clientId, organizationId: user.organizationId! },
      select: { id: true },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));

    const result = await prisma.$transaction(async (tx) => {
      const connections = await tx.metaConnection.updateMany({
        where: { organizationId: user.organizationId!, clientId: client.id, status: 'active' },
        data: { status: 'disconnected' },
      });
      const accounts = await tx.metaAdAccount.updateMany({
        where: { organizationId: user.organizationId!, clientId: client.id, isActive: true },
        data: { isActive: false, isAssigned: false },
      });
      await tx.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'META_DISCONNECTED',
          entity: 'Client',
          entityId: client.id,
          metadataJson: { connectionsDisabled: connections.count, accountsDisabled: accounts.count, historyPreserved: true },
        },
      });
      return { connectionsDisabled: connections.count, accountsDisabled: accounts.count };
    });

    return ok({ clientId: client.id, disconnected: true, historyPreserved: true, ...result },
      'Meta Ads desconectado. O histórico sincronizado foi preservado.');
  });

  app.get('/access/users', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req) => {
    const user = req.user as AuthUser;
    const users = await prisma.user.findMany({
      where: { organizationId: user.organizationId!, role: { in: ['CLIENT', 'MANAGER'] } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clientId: true,
        isActive: true,
        lastLoginAt: true,
        client: { select: { name: true } },
      },
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    });
    return ok(users);
  });

  app.post('/access/users', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const admin = req.user as AuthUser;
    const body = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email(),
      password: z.string().min(12).max(200),
      clientId: z.string().uuid(),
      role: z.enum(['CLIENT', 'MANAGER']).default('CLIENT'),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados do usuário inválidos.'));

    const client = await prisma.client.findFirst({
      where: { id: body.data.clientId, organizationId: admin.organizationId! },
      select: { id: true },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para vincular o usuário.'));

    const email = body.data.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send(fail('EMAIL_IN_USE', 'Já existe um usuário com este e-mail.'));

    const passwordHash = await hashPassword(body.data.password);
    const created = await prisma.user.create({
      data: {
        name: body.data.name,
        email,
        passwordHash,
        role: body.data.role,
        organizationId: admin.organizationId!,
        clientId: client.id,
        isActive: true,
        mustChangePassword: false,
      },
      select: { id: true, name: true, email: true, role: true, clientId: true, isActive: true },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: admin.organizationId,
        userId: admin.id,
        action: 'CREATE_TENANT_USER',
        entity: 'User',
        entityId: created.id,
        metadataJson: { clientId: created.clientId, role: created.role },
      },
    });

    return ok(created, 'Usuário criado e isolado na empresa selecionada.');
  });

  app.patch('/access/users/:id/status', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const admin = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ isActive: z.boolean() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(fail('VALIDATION', 'Alteração de usuário inválida.'));

    const target = await prisma.user.findFirst({
      where: {
        id: params.data.id,
        organizationId: admin.organizationId!,
        role: { in: ['CLIENT', 'MANAGER'] },
      },
      select: { id: true },
    });
    if (!target) return reply.code(404).send(fail('USER_NOT_FOUND', 'Usuário não encontrado para este acesso.'));

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { isActive: body.data.isActive },
      select: { id: true, name: true, email: true, role: true, clientId: true, isActive: true },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: admin.organizationId,
        userId: admin.id,
        action: body.data.isActive ? 'ACTIVATE_TENANT_USER' : 'DEACTIVATE_TENANT_USER',
        entity: 'User',
        entityId: updated.id,
      },
    });

    return ok(updated, body.data.isActive ? 'Usuário ativado.' : 'Usuário desativado.');
  });
}
