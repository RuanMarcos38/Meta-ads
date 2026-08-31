import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import dayjs from 'dayjs';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { prisma } from './shared/prisma.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { ok, fail } from './shared/response.js';
import { decrypt } from './shared/crypto.js';
import { hashPassword } from './shared/password.js';
import { MetaAdsService, type MetaBusinessDirectoryItem } from './modules/meta/MetaAdsService.js';
import { runSync } from './modules/meta/syncService.js';

const adminRoles = ['SUPER_ADMIN', 'AGENCY_ADMIN'] as const;
const tenantRoles = new Set(['CLIENT', 'MANAGER']);
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function effectiveClientId(user: AuthUser, requested?: string) {
  return scopeClient(user, requested);
}

function effectiveBusinessId(user: AuthUser, requested?: string) {
  if (tenantRoles.has(user.role)) return user.businessId || '__NO_BUSINESS__';
  return requested;
}

function preferredEmail(business: MetaBusinessDirectoryItem) {
  return business.admins.find((item) => item.email)?.email
    || business.users.find((item) => item.email)?.email
    || business.pendingUsers.find((item) => item.email)?.email
    || null;
}

async function activeConnection(organizationId: string, clientId: string) {
  return prisma.metaConnection.findFirst({
    where: { organizationId, clientId, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  });
}

async function ensureClientAccess(user: AuthUser, clientId: string, reply: FastifyReply) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: user.organizationId! },
  });
  if (!client) {
    reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para este acesso.'));
    return null;
  }
  return client;
}

async function syncBusinessDirectory(user: AuthUser, clientId: string) {
  const connection = await activeConnection(user.organizationId!, clientId);
  if (!connection) return { businesses: [], mappedAccounts: 0, connection: null };

  const meta = new MetaAdsService(decrypt(connection.accessTokenEncrypted));
  const businesses = await meta.businessDirectory();
  let mappedAccounts = 0;

  for (const business of businesses) {
    const manager = await prisma.businessManager.upsert({
      where: {
        organizationId_clientId_metaBusinessId: {
          organizationId: user.organizationId!,
          clientId,
          metaBusinessId: business.businessId,
        },
      },
      update: {
        name: business.businessName,
        adminEmail: preferredEmail(business),
        status: 'active',
        connectionStatus: 'connected',
        tokenStatus: connection.tokenExpiresAt && connection.tokenExpiresAt < new Date() ? 'expired' : 'valid',
        lastError: null,
      },
      create: {
        organizationId: user.organizationId!,
        clientId,
        metaBusinessId: business.businessId,
        name: business.businessName,
        adminEmail: preferredEmail(business),
        status: 'active',
        connectionStatus: 'connected',
        tokenStatus: connection.tokenExpiresAt && connection.tokenExpiresAt < new Date() ? 'expired' : 'valid',
      },
    });

    const ids = business.adAccounts.map((account) => account.accountId).filter(Boolean);
    if (ids.length) {
      const result = await prisma.metaAdAccount.updateMany({
        where: { organizationId: user.organizationId!, clientId, accountId: { in: ids } },
        data: {
          businessId: business.businessId,
          businessName: business.businessName,
          businessManagerId: manager.id,
        },
      });
      mappedAccounts += result.count;
    }
  }

  return { businesses, mappedAccounts, connection };
}

type MetricAccumulator = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  inlineLinkClicks: number;
  leads: number;
  conversations: number;
  purchases: number;
  revenue: number;
};

function emptyMetrics(): MetricAccumulator {
  return { spend: 0, impressions: 0, reach: 0, clicks: 0, inlineLinkClicks: 0, leads: 0, conversations: 0, purchases: 0, revenue: 0 };
}

function addMetric(target: MetricAccumulator, row: any) {
  target.spend += Number(row.spend || 0);
  target.impressions += Number(row.impressions || 0);
  target.reach += Number(row.reach || 0);
  target.clicks += Number(row.clicks || 0);
  target.inlineLinkClicks += Number(row.inlineLinkClicks || 0);
  target.leads += Number(row.leads || 0);
  target.conversations += Number(row.conversations || 0);
  target.purchases += Number(row.purchases || 0);
  target.revenue += Number(row.revenue || 0);
  return target;
}

function decorated(metric: MetricAccumulator) {
  return {
    ...metric,
    frequency: metric.reach ? metric.impressions / metric.reach : 0,
    ctr: metric.impressions ? metric.clicks / metric.impressions * 100 : 0,
    cpc: metric.clicks ? metric.spend / metric.clicks : 0,
    cpm: metric.impressions ? metric.spend / metric.impressions * 1000 : 0,
    cpl: metric.leads ? metric.spend / metric.leads : 0,
    costPerConversation: metric.conversations ? metric.spend / metric.conversations : 0,
    cpa: metric.purchases ? metric.spend / metric.purchases : 0,
    roas: metric.spend ? metric.revenue / metric.spend : 0,
  };
}

async function campaignReportRows(input: {
  organizationId: string;
  clientId: string;
  businessId?: string;
  adAccountId?: string;
  since: string;
  until: string;
}) {
  const accounts = await prisma.metaAdAccount.findMany({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      isAssigned: true,
      isActive: true,
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.adAccountId ? { id: input.adAccountId } : {}),
    },
    select: { id: true, accountId: true, name: true, businessId: true, businessName: true, currency: true },
  });
  const accountIds = accounts.map((item) => item.id);
  const campaigns = accountIds.length ? await prisma.campaign.findMany({
    where: { organizationId: input.organizationId, clientId: input.clientId, adAccountId: { in: accountIds } },
    include: { adAccount: { select: { id: true, name: true, accountId: true, businessName: true, businessId: true } } },
    orderBy: { name: 'asc' },
  }) : [];
  const metaIds = campaigns.map((item) => item.metaCampaignId);
  const insights = metaIds.length ? await prisma.insightDaily.findMany({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      adAccountId: { in: accountIds },
      level: 'campaign',
      campaignId: { in: metaIds },
      date: {
        gte: new Date(`${input.since}T00:00:00.000Z`),
        lte: new Date(`${input.until}T23:59:59.999Z`),
      },
    },
  }) : [];
  const map = new Map<string, MetricAccumulator>();
  for (const row of insights) {
    if (!row.campaignId) continue;
    const current = map.get(row.campaignId) || emptyMetrics();
    addMetric(current, row);
    map.set(row.campaignId, current);
  }
  return campaigns.map((campaign) => ({
    id: campaign.id,
    metaCampaignId: campaign.metaCampaignId,
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective,
    businessName: campaign.adAccount.businessName,
    businessId: campaign.adAccount.businessId,
    accountName: campaign.adAccount.name,
    accountId: campaign.adAccount.accountId,
    ...decorated(map.get(campaign.metaCampaignId) || emptyMetrics()),
  }));
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

async function bufferPdf(title: string, period: string, rows: any[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).text(title);
    doc.moveDown(0.25).fontSize(9).fillColor('#555').text(period);
    doc.moveDown().fillColor('#111').fontSize(8);
    const headers = ['Campanha', 'Conta', 'Invest.', 'Leads', 'CPL', 'Conv.', 'CTR', 'CPC', 'CPM', 'Compras', 'CPA', 'ROAS'];
    doc.text(headers.join('   '));
    doc.moveDown(0.35);
    rows.slice(0, 120).forEach((row) => {
      doc.text([
        String(row.name || '').slice(0, 32),
        String(row.accountName || row.accountId || '').slice(0, 18),
        Number(row.spend || 0).toFixed(2),
        row.leads || 0,
        Number(row.cpl || 0).toFixed(2),
        row.conversations || 0,
        `${Number(row.ctr || 0).toFixed(2)}%`,
        Number(row.cpc || 0).toFixed(2),
        Number(row.cpm || 0).toFixed(2),
        row.purchases || 0,
        Number(row.cpa || 0).toFixed(2),
        Number(row.roas || 0).toFixed(2),
      ].join('   '));
    });
    doc.end();
  });
}

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  app.get('/workspace/context', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtro de empresa inválido.'));
    const lockedClientId = effectiveClientId(user, query.data.clientId);
    const lockedBusinessId = effectiveBusinessId(user);
    if (tenantRoles.has(user.role) && (!lockedClientId || lockedBusinessId === '__NO_BUSINESS__')) {
      return reply.code(403).send(fail('TENANT_SCOPE_REQUIRED', 'Este acesso precisa estar vinculado a uma empresa e uma BM.'));
    }

    const clients = await prisma.client.findMany({
      where: { organizationId: user.organizationId!, ...(lockedClientId ? { id: lockedClientId } : {}) },
      select: {
        id: true, name: true, companyName: true, email: true, status: true,
        _count: { select: { users: true, adAccounts: true, businessManagers: true } },
      },
      orderBy: { name: 'asc' },
    });
    const clientIds = clients.map((item) => item.id);
    const businesses = clientIds.length ? await prisma.businessManager.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId: { in: clientIds },
        status: 'active',
        ...(lockedBusinessId && lockedBusinessId !== '__NO_BUSINESS__' ? { metaBusinessId: lockedBusinessId } : {}),
      },
      orderBy: [{ clientId: 'asc' }, { name: 'asc' }],
    }) : [];
    const accounts = clientIds.length ? await prisma.metaAdAccount.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId: { in: clientIds },
        ...(tenantRoles.has(user.role) ? { isAssigned: true } : {}),
        ...(lockedBusinessId && lockedBusinessId !== '__NO_BUSINESS__' ? { businessId: lockedBusinessId } : {}),
      },
      select: {
        id: true, clientId: true, businessManagerId: true, businessId: true, businessName: true,
        accountId: true, name: true, currency: true, timezone: true, accountStatus: true,
        isActive: true, isAssigned: true, updatedAt: true,
      },
      orderBy: [{ businessName: 'asc' }, { name: 'asc' }],
    }) : [];

    return ok({
      role: user.role,
      tenantLocked: tenantRoles.has(user.role),
      selectedClientId: lockedClientId || null,
      selectedBusinessId: lockedBusinessId && lockedBusinessId !== '__NO_BUSINESS__' ? lockedBusinessId : null,
      clients,
      businesses,
      accounts,
    });
  });

  app.post('/workspace/business-managers/refresh', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));
    const clients = await prisma.client.findMany({
      where: { organizationId: user.organizationId!, ...(body.data.clientId ? { id: body.data.clientId } : {}) },
      select: { id: true, name: true },
    });
    const results: any[] = [];
    for (const client of clients) {
      try {
        const refreshed = await syncBusinessDirectory(user, client.id);
        results.push({ clientId: client.id, name: client.name, businesses: refreshed.businesses.length, mappedAccounts: refreshed.mappedAccounts, ok: true });
      } catch (error: any) {
        results.push({ clientId: client.id, name: client.name, businesses: 0, mappedAccounts: 0, ok: false, error: error?.message || 'Falha ao consultar a Meta.' });
      }
    }
    await prisma.auditLog.create({
      data: { organizationId: user.organizationId, userId: user.id, action: 'REFRESH_BUSINESS_DIRECTORY', entity: 'BusinessManager', metadataJson: { results } },
    });
    return ok(results, 'Diretório de Business Managers atualizado.');
  });

  app.get('/workspace/business-managers', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));
    const clientId = effectiveClientId(user, query.data.clientId);
    const businessId = effectiveBusinessId(user);
    if (tenantRoles.has(user.role) && (!clientId || businessId === '__NO_BUSINESS__')) return reply.code(403).send(fail('TENANT_SCOPE_REQUIRED', 'BM não vinculada ao usuário.'));
    const businesses = await prisma.businessManager.findMany({
      where: {
        organizationId: user.organizationId!,
        ...(clientId ? { clientId } : {}),
        ...(businessId && businessId !== '__NO_BUSINESS__' ? { metaBusinessId: businessId } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        _count: { select: { adAccounts: true } },
      },
      orderBy: [{ clientId: 'asc' }, { name: 'asc' }],
    });
    return ok(businesses);
  });

  app.patch('/workspace/business-managers/:id', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ adminEmail: z.string().email().nullable().optional(), status: z.enum(['active', 'inactive']).optional() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(fail('VALIDATION', 'Dados da BM inválidos.'));
    const manager = await prisma.businessManager.findFirst({ where: { id: params.data.id, organizationId: user.organizationId! } });
    if (!manager) return reply.code(404).send(fail('BUSINESS_NOT_FOUND', 'Business Manager não encontrada.'));
    const updated = await prisma.businessManager.update({ where: { id: manager.id }, data: body.data });
    await prisma.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, businessId: manager.metaBusinessId, action: 'UPDATE_BUSINESS_MANAGER', entity: 'BusinessManager', entityId: manager.id, metadataJson: body.data } });
    return ok(updated, 'Business Manager atualizada.');
  });

  app.post('/workspace/business-managers/:id/sync', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER']) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ since: dateText.optional(), until: dateText.optional(), fullHistory: z.boolean().optional() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(fail('VALIDATION', 'Parâmetros de sincronização inválidos.'));
    const manager = await prisma.businessManager.findFirst({ where: { id: params.data.id, organizationId: user.organizationId! } });
    if (!manager) return reply.code(404).send(fail('BUSINESS_NOT_FOUND', 'Business Manager não encontrada.'));
    const scopedClientId = effectiveClientId(user, manager.clientId);
    const scopedBusinessId = effectiveBusinessId(user, manager.metaBusinessId);
    if (scopedClientId !== manager.clientId || (tenantRoles.has(user.role) && scopedBusinessId !== manager.metaBusinessId)) return reply.code(403).send(fail('FORBIDDEN', 'Esta BM não pertence ao seu acesso.'));
    try {
      const result = await runSync(user.organizationId!, manager.clientId, user.id, body.data.fullHistory ? 'history' : 'manual', { ...body.data, businessId: manager.metaBusinessId });
      return ok(result, body.data.fullHistory ? 'Histórico completo da BM sincronizado.' : 'BM sincronizada com sucesso.');
    } catch {
      return reply.code(502).send(fail('META_SYNC_ERROR', 'Não foi possível sincronizar esta BM. As demais continuam operando normalmente.'));
    }
  });

  app.get('/workspace/integration-health', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional(), businessId: z.string().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtro inválido.'));
    const clientId = effectiveClientId(user, query.data.clientId);
    const businessId = effectiveBusinessId(user, query.data.businessId);
    if (tenantRoles.has(user.role) && (!clientId || businessId === '__NO_BUSINESS__')) return reply.code(403).send(fail('TENANT_SCOPE_REQUIRED', 'Empresa/BM não vinculada.'));
    const managers = await prisma.businessManager.findMany({
      where: {
        organizationId: user.organizationId!,
        ...(clientId ? { clientId } : {}),
        ...(businessId && businessId !== '__NO_BUSINESS__' ? { metaBusinessId: businessId } : {}),
      },
      include: { client: { select: { name: true } }, adAccounts: { where: { isActive: true }, select: { id: true, isAssigned: true } } },
      orderBy: { name: 'asc' },
    });
    const rows = [];
    for (const manager of managers) {
      const connection = await activeConnection(user.organizationId!, manager.clientId);
      const latestJob = await prisma.syncJob.findFirst({ where: { organizationId: user.organizationId!, clientId: manager.clientId, businessId: manager.metaBusinessId }, orderBy: { startedAt: 'desc' } });
      const assignedIds = manager.adAccounts.filter((item) => item.isAssigned).map((item) => item.id);
      const range = assignedIds.length ? await prisma.insightDaily.aggregate({
        where: { organizationId: user.organizationId!, clientId: manager.clientId, adAccountId: { in: assignedIds } },
        _min: { date: true }, _max: { date: true }, _count: { id: true },
      }) : null;
      const expiresAt = connection?.tokenExpiresAt || null;
      const tokenStatus = !connection ? 'disconnected' : expiresAt && expiresAt < new Date() ? 'expired' : expiresAt && dayjs(expiresAt).diff(dayjs(), 'day') <= 7 ? 'expiring' : 'valid';
      rows.push({
        id: manager.id,
        clientId: manager.clientId,
        clientName: manager.client.name,
        businessId: manager.metaBusinessId,
        businessName: manager.name,
        adminEmail: manager.adminEmail,
        connected: Boolean(connection),
        tokenStatus,
        tokenExpiresAt: expiresAt,
        scopes: connection?.scopes || '',
        accountCount: manager.adAccounts.length,
        assignedAccountCount: assignedIds.length,
        lastSyncAt: latestJob?.finishedAt || manager.lastSyncAt,
        lastSyncStatus: latestJob?.status || 'never',
        recordsProcessed: latestJob?.recordsProcessed || 0,
        lastError: latestJob?.errorMessage || manager.lastError,
        earliestDate: range?._min.date || null,
        latestDate: range?._max.date || null,
        dataRows: range?._count.id || 0,
      });
    }
    return ok(rows);
  });

  app.get('/workspace/users', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER']) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));
    const clientId = effectiveClientId(user, query.data.clientId);
    const rows = await prisma.user.findMany({
      where: { organizationId: user.organizationId!, ...(clientId ? { clientId } : {}) },
      select: { id: true, name: true, email: true, role: true, clientId: true, businessId: true, isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true },
      orderBy: [{ clientId: 'asc' }, { name: 'asc' }],
    });
    return ok(rows);
  });

  app.post('/workspace/users', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email(),
      password: z.string().min(10).max(200),
      role: z.enum(['AGENCY_ADMIN', 'MANAGER', 'CLIENT']),
      clientId: z.string().uuid().nullable().optional(),
      businessId: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados do usuário inválidos.'));
    if (['MANAGER', 'CLIENT'].includes(body.data.role) && (!body.data.clientId || !body.data.businessId)) return reply.code(400).send(fail('BUSINESS_REQUIRED', 'Cliente/Gestor precisa estar vinculado a uma empresa e BM.'));
    if (body.data.clientId) {
      const client = await prisma.client.findFirst({ where: { id: body.data.clientId, organizationId: user.organizationId! } });
      if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));
      if (body.data.businessId) {
        const bm = await prisma.businessManager.findFirst({ where: { organizationId: user.organizationId!, clientId: client.id, metaBusinessId: body.data.businessId } });
        if (!bm) return reply.code(404).send(fail('BUSINESS_NOT_FOUND', 'BM não encontrada para esta empresa.'));
      }
    }
    const created = await prisma.user.create({
      data: {
        name: body.data.name,
        email: body.data.email.trim().toLowerCase(),
        passwordHash: await hashPassword(body.data.password),
        role: body.data.role,
        organizationId: user.organizationId!,
        clientId: body.data.clientId || null,
        businessId: body.data.businessId || null,
        mustChangePassword: true,
      },
      select: { id: true, name: true, email: true, role: true, clientId: true, businessId: true, isActive: true, mustChangePassword: true },
    });
    await prisma.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, businessId: created.businessId, action: 'CREATE_USER_ACCESS', entity: 'User', entityId: created.id, metadataJson: { email: created.email, role: created.role, clientId: created.clientId } } });
    return ok(created, 'Acesso criado.');
  });

  app.patch('/workspace/users/:id', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ isActive: z.boolean().optional(), businessId: z.string().nullable().optional(), clientId: z.string().uuid().nullable().optional(), role: z.enum(['AGENCY_ADMIN', 'MANAGER', 'CLIENT']).optional(), password: z.string().min(10).max(200).optional() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(fail('VALIDATION', 'Alteração de acesso inválida.'));
    const existing = await prisma.user.findFirst({ where: { id: params.data.id, organizationId: user.organizationId! } });
    if (!existing) return reply.code(404).send(fail('USER_NOT_FOUND', 'Usuário não encontrado.'));
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(body.data.isActive !== undefined ? { isActive: body.data.isActive } : {}),
        ...(body.data.businessId !== undefined ? { businessId: body.data.businessId } : {}),
        ...(body.data.clientId !== undefined ? { clientId: body.data.clientId } : {}),
        ...(body.data.role ? { role: body.data.role } : {}),
        ...(body.data.password ? { passwordHash: await hashPassword(body.data.password), mustChangePassword: true } : {}),
      },
      select: { id: true, name: true, email: true, role: true, clientId: true, businessId: true, isActive: true, mustChangePassword: true, lastLoginAt: true },
    });
    await prisma.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, businessId: updated.businessId, action: 'UPDATE_USER_ACCESS', entity: 'User', entityId: updated.id, metadataJson: body.data } });
    return ok(updated, 'Acesso atualizado.');
  });

  app.get('/workspace/audit', { preHandler: requireAuth([...adminRoles]) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional(), businessId: z.string().optional(), take: z.coerce.number().int().min(1).max(500).default(100) }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtro de auditoria inválido.'));
    const rows = await prisma.auditLog.findMany({
      where: {
        organizationId: user.organizationId!,
        ...(query.data.businessId ? { businessId: query.data.businessId } : {}),
        ...(query.data.clientId ? { metadataJson: { path: ['clientId'], equals: query.data.clientId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.data.take,
    });
    return ok(rows);
  });

  app.get('/workspace/alerts', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional(), businessId: z.string().optional(), unread: z.coerce.boolean().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtro de alertas inválido.'));
    const clientId = effectiveClientId(user, query.data.clientId);
    const businessId = effectiveBusinessId(user, query.data.businessId);
    const rows = await prisma.alert.findMany({
      where: {
        organizationId: user.organizationId!,
        ...(clientId ? { clientId } : {}),
        ...(businessId && businessId !== '__NO_BUSINESS__' ? { businessId } : {}),
        ...(query.data.unread ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ok(rows);
  });

  app.post('/workspace/alerts/evaluate', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER']) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({ clientId: z.string().uuid().optional(), businessId: z.string().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Escopo de alertas inválido.'));
    const clientId = effectiveClientId(user, body.data.clientId);
    const businessId = effectiveBusinessId(user, body.data.businessId);
    if (!clientId) return reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa.'));
    const since = dayjs().subtract(6, 'day').format('YYYY-MM-DD');
    const until = dayjs().format('YYYY-MM-DD');
    const rows = await campaignReportRows({ organizationId: user.organizationId!, clientId, businessId: businessId === '__NO_BUSINESS__' ? undefined : businessId, since, until });
    const candidates: Array<{ type: string; severity: string; title: string; message: string }> = [];
    for (const row of rows) {
      if (row.spend >= 20 && row.leads === 0) candidates.push({ type: 'SPEND_WITHOUT_LEAD', severity: 'warning', title: `Gasto sem lead: ${row.name}`, message: `A campanha investiu R$ ${row.spend.toFixed(2)} nos últimos 7 dias e não registrou leads.` });
      if (row.impressions >= 1000 && row.ctr < 0.7) candidates.push({ type: 'LOW_CTR', severity: 'warning', title: `CTR baixo: ${row.name}`, message: `CTR de ${row.ctr.toFixed(2)}% no período. Revise criativo, oferta e público.` });
      if (row.frequency >= 3.5) candidates.push({ type: 'HIGH_FREQUENCY', severity: 'info', title: `Frequência alta: ${row.name}`, message: `Frequência média de ${row.frequency.toFixed(2)}. Avalie fadiga do criativo.` });
      if (row.roas > 0 && row.roas < 1) candidates.push({ type: 'LOW_ROAS', severity: 'warning', title: `ROAS abaixo de 1: ${row.name}`, message: `ROAS atual de ${row.roas.toFixed(2)}x.` });
    }
    const manager = businessId && businessId !== '__NO_BUSINESS__' ? await prisma.businessManager.findFirst({ where: { organizationId: user.organizationId!, clientId, metaBusinessId: businessId } }) : null;
    if (manager?.tokenStatus === 'expired') candidates.push({ type: 'TOKEN_EXPIRED', severity: 'critical', title: `Token expirado: ${manager.name}`, message: 'Reconecte a Meta para retomar a sincronização.' });
    let created = 0;
    for (const candidate of candidates) {
      const recent = await prisma.alert.findFirst({ where: { organizationId: user.organizationId!, clientId, businessId: businessId === '__NO_BUSINESS__' ? null : businessId, type: candidate.type, title: candidate.title, createdAt: { gte: dayjs().subtract(12, 'hour').toDate() } } });
      if (recent) continue;
      await prisma.alert.create({ data: { organizationId: user.organizationId!, clientId, businessId: businessId === '__NO_BUSINESS__' ? null : businessId, ...candidate } });
      created += 1;
    }
    return ok({ evaluated: rows.length, created }, 'Avaliação concluída.');
  });

  app.patch('/workspace/alerts/:id/read', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send(fail('VALIDATION', 'Alerta inválido.'));
    const alert = await prisma.alert.findFirst({ where: { id: params.data.id, organizationId: user.organizationId! } });
    if (!alert) return reply.code(404).send(fail('ALERT_NOT_FOUND', 'Alerta não encontrado.'));
    if (tenantRoles.has(user.role) && (alert.clientId !== user.clientId || (alert.businessId && alert.businessId !== user.businessId))) return reply.code(403).send(fail('FORBIDDEN', 'Alerta fora do seu escopo.'));
    return ok(await prisma.alert.update({ where: { id: alert.id }, data: { isRead: true } }));
  });

  app.get('/workspace/reports', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional(), businessId: z.string().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtro de relatórios inválido.'));
    const clientId = effectiveClientId(user, query.data.clientId);
    const businessId = effectiveBusinessId(user, query.data.businessId);
    const rows = await prisma.report.findMany({
      where: { organizationId: user.organizationId!, ...(clientId ? { clientId } : {}), ...(businessId && businessId !== '__NO_BUSINESS__' ? { businessId } : {}) },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return ok(rows);
  });

  app.post('/workspace/reports', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({
      clientId: z.string().uuid().optional(), businessId: z.string().optional(), adAccountId: z.string().uuid().optional(),
      title: z.string().trim().min(3).max(160), since: dateText, until: dateText,
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados do relatório inválidos.'));
    const clientId = effectiveClientId(user, body.data.clientId);
    const businessId = effectiveBusinessId(user, body.data.businessId);
    if (!clientId) return reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa.'));
    const rows = await campaignReportRows({ organizationId: user.organizationId!, clientId, businessId: businessId === '__NO_BUSINESS__' ? undefined : businessId, adAccountId: body.data.adAccountId, since: body.data.since, until: body.data.until });
    const total = decorated(rows.reduce((acc, row) => addMetric(acc, row), emptyMetrics()));
    const report = await prisma.report.create({
      data: {
        organizationId: user.organizationId!, clientId,
        businessId: businessId === '__NO_BUSINESS__' ? null : businessId,
        adAccountId: body.data.adAccountId || null,
        title: body.data.title,
        periodStart: new Date(`${body.data.since}T00:00:00.000Z`), periodEnd: new Date(`${body.data.until}T23:59:59.999Z`),
        summaryText: `Investimento R$ ${total.spend.toFixed(2)} | Leads ${total.leads} | CPL R$ ${total.cpl.toFixed(2)} | Conversas ${total.conversations} | ROAS ${total.roas.toFixed(2)}x`,
        metadataJson: { since: body.data.since, until: body.data.until, total, campaigns: rows.length },
        createdBy: user.id,
      },
    });
    return ok(report, 'Relatório salvo.');
  });

  app.get('/workspace/reports/:id/export', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const query = z.object({ format: z.enum(['csv', 'pdf', 'xlsx']).default('pdf') }).safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send(fail('VALIDATION', 'Exportação inválida.'));
    const report = await prisma.report.findFirst({ where: { id: params.data.id, organizationId: user.organizationId! } });
    if (!report) return reply.code(404).send(fail('REPORT_NOT_FOUND', 'Relatório não encontrado.'));
    if (tenantRoles.has(user.role) && (report.clientId !== user.clientId || (report.businessId && report.businessId !== user.businessId))) return reply.code(403).send(fail('FORBIDDEN', 'Relatório fora do seu escopo.'));
    const since = dayjs(report.periodStart).format('YYYY-MM-DD');
    const until = dayjs(report.periodEnd).format('YYYY-MM-DD');
    const rows = await campaignReportRows({ organizationId: user.organizationId!, clientId: report.clientId, businessId: report.businessId || undefined, adAccountId: report.adAccountId || undefined, since, until });
    const fileBase = report.title.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-|-$/g, '') || 'relatorio';

    if (query.data.format === 'csv') {
      const header = ['Campanha','BM','Conta','Status','Investimento','Leads','CPL','Conversas','Custo conversa','CTR','CPC','CPM','Compras','CPA','Receita','ROAS'];
      const content = [header.map(csvEscape).join(';'), ...rows.map((row) => [row.name,row.businessName,row.accountName,row.status,row.spend,row.leads,row.cpl,row.conversations,row.costPerConversation,row.ctr,row.cpc,row.cpm,row.purchases,row.cpa,row.revenue,row.roas].map(csvEscape).join(';'))].join('\n');
      return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${fileBase}.csv"`).send(`\uFEFF${content}`);
    }

    if (query.data.format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Campanhas');
      sheet.columns = [
        ['Campanha','name'],['BM','businessName'],['Conta','accountName'],['Status','status'],['Investimento','spend'],['Leads','leads'],['CPL','cpl'],['Conversas','conversations'],['Custo conversa','costPerConversation'],['CTR','ctr'],['CPC','cpc'],['CPM','cpm'],['Compras','purchases'],['CPA','cpa'],['Receita','revenue'],['ROAS','roas'],
      ].map(([header,key]) => ({ header, key, width: 18 }));
      rows.forEach((row) => sheet.addRow(row));
      sheet.getRow(1).font = { bold: true };
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${fileBase}.xlsx"`).send(buffer);
    }

    const pdf = await bufferPdf(report.title, `${since} a ${until}`, rows);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${fileBase}.pdf"`).send(pdf);
  });
}
