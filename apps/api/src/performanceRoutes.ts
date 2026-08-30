import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import dayjs from 'dayjs';
import { prisma } from './shared/prisma.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';
import { runSync } from './modules/meta/syncService.js';

const asNumber = (value: unknown) => Number(value ?? 0);
const restrictedRoles = new Set(['CLIENT', 'MANAGER']);
const adminRoles = new Set(['SUPER_ADMIN', 'AGENCY_ADMIN']);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const performanceScopeSchema = z.object({
  clientId: z.string().uuid().optional(),
  businessId: z.string().trim().min(1).max(100).optional(),
  adAccountId: z.string().uuid().optional(),
  campaignId: z.string().trim().min(1).max(100).optional(),
  adSetId: z.string().trim().min(1).max(100).optional(),
  since: dateString.optional(),
  until: dateString.optional(),
});

type PerformanceInput = z.infer<typeof performanceScopeSchema>;
type ResolvedPerformanceScope = {
  clientId: string;
  accountIds: string[];
  campaignId?: string;
  adSetId?: string;
  since: string;
  until: string;
  sinceDate: Date;
  untilDate: Date;
};

type Totals = {
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

const emptyTotals = (): Totals => ({
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  inlineLinkClicks: 0,
  leads: 0,
  conversations: 0,
  purchases: 0,
  revenue: 0,
});

function addRow(total: Totals, row: any) {
  total.spend += asNumber(row.spend);
  total.impressions += Number(row.impressions || 0);
  total.reach += Number(row.reach || 0);
  total.clicks += Number(row.clicks || 0);
  total.inlineLinkClicks += Number(row.inlineLinkClicks || 0);
  total.leads += Number(row.leads || 0);
  total.conversations += Number(row.conversations || 0);
  total.purchases += Number(row.purchases || 0);
  total.revenue += asNumber(row.revenue);
  return total;
}

function decorateMetrics(metric: Totals) {
  return {
    ...metric,
    frequency: metric.reach ? metric.impressions / metric.reach : 0,
    cpm: metric.impressions ? (metric.spend / metric.impressions) * 1000 : 0,
    ctr: metric.impressions ? (metric.clicks / metric.impressions) * 100 : 0,
    linkCtr: metric.impressions ? (metric.inlineLinkClicks / metric.impressions) * 100 : 0,
    cpc: metric.clicks ? metric.spend / metric.clicks : 0,
    costPerLinkClick: metric.inlineLinkClicks ? metric.spend / metric.inlineLinkClicks : 0,
    costPerLead: metric.leads ? metric.spend / metric.leads : 0,
    costPerConversation: metric.conversations ? metric.spend / metric.conversations : 0,
    costPerPurchase: metric.purchases ? metric.spend / metric.purchases : 0,
    costPer1000PeopleReached: metric.reach ? (metric.spend / metric.reach) * 1000 : 0,
    leadRate: metric.clicks ? (metric.leads / metric.clicks) * 100 : 0,
    purchaseRate: metric.clicks ? (metric.purchases / metric.clicks) * 100 : 0,
    roas: metric.spend ? metric.revenue / metric.spend : 0,
  };
}

function metricMap(rows: any[], key: (row: any) => string | null | undefined) {
  const result = new Map<string, Totals>();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    const current = result.get(id) ?? emptyTotals();
    addRow(current, row);
    result.set(id, current);
  }
  return result;
}

function resolveDates(input: PerformanceInput, reply: FastifyReply) {
  const until = input.until ? dayjs(input.until) : dayjs();
  const since = input.since ? dayjs(input.since) : until.subtract(30, 'day');
  if (!since.isValid() || !until.isValid()) {
    reply.code(400).send(fail('INVALID_PERIOD', 'Período informado é inválido.'));
    return null;
  }
  if (since.isAfter(until)) {
    reply.code(400).send(fail('INVALID_PERIOD', 'A data inicial não pode ser posterior à data final.'));
    return null;
  }
  if (until.diff(since, 'day') > 7300) {
    reply.code(400).send(fail('PERIOD_TOO_LONG', 'Selecione um período de até 20 anos por consulta.'));
    return null;
  }
  const sinceText = since.format('YYYY-MM-DD');
  const untilText = until.format('YYYY-MM-DD');
  return {
    since: sinceText,
    until: untilText,
    sinceDate: new Date(`${sinceText}T00:00:00.000Z`),
    untilDate: new Date(`${untilText}T23:59:59.999Z`),
  };
}

async function resolvePerformanceScope(user: AuthUser, input: PerformanceInput, reply: FastifyReply): Promise<ResolvedPerformanceScope | null> {
  const dates = resolveDates(input, reply);
  if (!dates) return null;

  const clientId = scopeClient(user, input.clientId);
  if (!clientId) {
    reply.code(restrictedRoles.has(user.role) ? 403 : 400).send(fail(
      restrictedRoles.has(user.role) ? 'CLIENT_SCOPE_REQUIRED' : 'CLIENT_REQUIRED',
      restrictedRoles.has(user.role)
        ? 'Este usuário precisa estar vinculado a uma empresa.'
        : 'Selecione uma empresa para consultar as métricas.',
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
      isActive: true,
      isAssigned: true,
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.adAccountId ? { id: input.adAccountId } : {}),
    },
    select: { id: true },
  });

  if (input.adAccountId && accounts.length === 0) {
    reply.code(404).send(fail('META_ACCOUNT_NOT_ASSIGNED', 'Esta conta Meta não está autorizada para a empresa/BM selecionada.'));
    return null;
  }

  return {
    clientId,
    accountIds: accounts.map((account) => account.id),
    campaignId: input.campaignId,
    adSetId: input.adSetId,
    ...dates,
  };
}

function insightWhere(user: AuthUser, scope: ResolvedPerformanceScope, level: 'campaign' | 'adset' | 'ad') {
  return {
    organizationId: user.organizationId!,
    clientId: scope.clientId,
    level,
    adAccountId: { in: scope.accountIds },
    date: { gte: scope.sinceDate, lte: scope.untilDate },
    ...(scope.campaignId ? { campaignId: scope.campaignId } : {}),
    ...(level !== 'campaign' && scope.adSetId ? { adSetId: scope.adSetId } : {}),
  };
}

async function ensureSyncClient(user: AuthUser, requestedClientId: string | undefined, reply: FastifyReply) {
  const clientId = scopeClient(user, requestedClientId);
  if (!clientId) {
    reply.code(restrictedRoles.has(user.role) ? 403 : 400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa para sincronizar.'));
    return null;
  }
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: user.organizationId! },
    select: { id: true, name: true },
  });
  if (!client) {
    reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para sincronização.'));
    return null;
  }
  const assignedAccounts = await prisma.metaAdAccount.count({
    where: { organizationId: user.organizationId!, clientId, isActive: true, isAssigned: true },
  });
  if (!assignedAccounts) {
    reply.code(409).send(fail('NO_ASSIGNED_META_ACCOUNTS', 'Selecione ao menos uma conta Meta antes de sincronizar.'));
    return null;
  }
  return client;
}

export async function registerPerformanceRoutes(app: FastifyInstance) {
  app.get('/performance/summary', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = performanceScopeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Filtros de desempenho inválidos.'));
    const scope = await resolvePerformanceScope(user, parsed.data, reply);
    if (!scope) return;
    const rows = scope.accountIds.length ? await prisma.insightDaily.findMany({ where: insightWhere(user, scope, 'campaign') }) : [];
    const totals = rows.reduce((acc, row) => addRow(acc, row), emptyTotals());
    return ok({ ...decorateMetrics(totals), period: { since: scope.since, until: scope.until } });
  });

  app.get('/performance/daily', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = performanceScopeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Filtros de desempenho inválidos.'));
    const scope = await resolvePerformanceScope(user, parsed.data, reply);
    if (!scope) return;
    const rows = scope.accountIds.length
      ? await prisma.insightDaily.findMany({ where: insightWhere(user, scope, 'campaign'), orderBy: { date: 'asc' } })
      : [];
    const daily = new Map<string, Totals>();
    for (const row of rows) {
      const iso = row.date.toISOString().slice(0, 10);
      const current = daily.get(iso) ?? emptyTotals();
      addRow(current, row);
      daily.set(iso, current);
    }
    return ok(Array.from(daily.entries()).map(([date, metric]) => ({ date, ...decorateMetrics(metric) })));
  });

  app.get('/performance/campaigns', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = performanceScopeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Filtros de desempenho inválidos.'));
    const scope = await resolvePerformanceScope(user, parsed.data, reply);
    if (!scope) return;

    const campaigns = scope.accountIds.length ? await prisma.campaign.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId: scope.clientId,
        adAccountId: { in: scope.accountIds },
        ...(parsed.data.campaignId ? { metaCampaignId: parsed.data.campaignId } : {}),
      },
      include: {
        adAccount: { select: { id: true, accountId: true, name: true, businessId: true, businessName: true, currency: true } },
        _count: { select: { adSets: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    }) : [];

    const ids = campaigns.map((item) => item.metaCampaignId);
    const rows = ids.length ? await prisma.insightDaily.findMany({
      where: { ...insightWhere(user, scope, 'campaign'), campaignId: { in: ids } },
    }) : [];
    const metrics = metricMap(rows, (row) => row.campaignId);

    return ok(campaigns.map((campaign) => ({
      ...campaign,
      adSetCount: campaign._count.adSets,
      ...decorateMetrics(metrics.get(campaign.metaCampaignId) ?? emptyTotals()),
      period: { since: scope.since, until: scope.until },
    })));
  });

  app.get('/performance/adsets', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = performanceScopeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Filtros de desempenho inválidos.'));
    const scope = await resolvePerformanceScope(user, parsed.data, reply);
    if (!scope) return;

    const adSets = scope.accountIds.length ? await prisma.adSet.findMany({
      where: {
        ...(parsed.data.adSetId ? { metaAdsetId: parsed.data.adSetId } : {}),
        campaign: {
          organizationId: user.organizationId!,
          clientId: scope.clientId,
          adAccountId: { in: scope.accountIds },
          ...(parsed.data.campaignId ? { metaCampaignId: parsed.data.campaignId } : {}),
        },
      },
      include: {
        campaign: { include: { adAccount: { select: { id: true, accountId: true, name: true, businessId: true, businessName: true, currency: true } } } },
        _count: { select: { ads: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }) : [];

    const ids = adSets.map((item) => item.metaAdsetId);
    const rows = ids.length ? await prisma.insightDaily.findMany({
      where: { ...insightWhere(user, scope, 'adset'), adSetId: { in: ids } },
    }) : [];
    const metrics = metricMap(rows, (row) => row.adSetId);

    return ok(adSets.map((adSet) => ({
      ...adSet,
      adCount: adSet._count.ads,
      ...decorateMetrics(metrics.get(adSet.metaAdsetId) ?? emptyTotals()),
      period: { since: scope.since, until: scope.until },
    })));
  });

  app.get('/performance/ads', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = performanceScopeSchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Filtros de desempenho inválidos.'));
    const scope = await resolvePerformanceScope(user, parsed.data, reply);
    if (!scope) return;

    const ads = scope.accountIds.length ? await prisma.ad.findMany({
      where: {
        adSet: {
          ...(parsed.data.adSetId ? { metaAdsetId: parsed.data.adSetId } : {}),
          campaign: {
            organizationId: user.organizationId!,
            clientId: scope.clientId,
            adAccountId: { in: scope.accountIds },
            ...(parsed.data.campaignId ? { metaCampaignId: parsed.data.campaignId } : {}),
          },
        },
      },
      include: {
        adSet: { include: { campaign: { include: { adAccount: { select: { id: true, accountId: true, name: true, businessId: true, businessName: true, currency: true } } } } } },
      },
      orderBy: { updatedAt: 'desc' },
    }) : [];

    const ids = ads.map((item) => item.metaAdId);
    const rows = ids.length ? await prisma.insightDaily.findMany({
      where: { ...insightWhere(user, scope, 'ad'), adId: { in: ids } },
    }) : [];
    const metrics = metricMap(rows, (row) => row.adId);

    return ok(ads.map((ad) => ({
      ...ad,
      ...decorateMetrics(metrics.get(ad.metaAdId) ?? emptyTotals()),
      period: { since: scope.since, until: scope.until },
    })));
  });

  app.post('/performance/sync', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = performanceScopeSchema.pick({ clientId: true, since: true, until: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Empresa ou período inválido para sincronização.'));
    const dates = resolveDates(parsed.data, reply);
    if (!dates) return;
    const client = await ensureSyncClient(user, parsed.data.clientId, reply);
    if (!client) return;

    try {
      const result = await runSync(user.organizationId!, client.id, user.id, 'manual', { since: dates.since, until: dates.until });
      return ok(result, 'Métricas, conjuntos e anúncios sincronizados com a Meta.');
    } catch (error: any) {
      req.log.error({ err: error, clientId: client.id, since: dates.since, until: dates.until }, 'performance sync failed');
      return reply.code(502).send(fail('META_SYNC_ERROR', 'Falha ao sincronizar o período selecionado com a Meta.'));
    }
  });

  app.get('/performance/history-status', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = performanceScopeSchema.pick({ clientId: true }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));
    const client = await ensureSyncClient(user, parsed.data.clientId, reply);
    if (!client) return;

    const [coverage, latestJob] = await Promise.all([
      prisma.insightDaily.aggregate({
        where: { organizationId: user.organizationId!, clientId: client.id, level: 'campaign' },
        _min: { date: true },
        _max: { date: true },
        _count: { id: true },
      }),
      prisma.syncJob.findFirst({
        where: { organizationId: user.organizationId!, clientId: client.id, type: { in: ['history', 'history_full'] } },
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    return ok({
      clientId: client.id,
      clientName: client.name,
      earliestDate: coverage._min.date,
      latestDate: coverage._max.date,
      dailyRows: coverage._count.id,
      latestJob,
    });
  });

  app.post('/performance/history-sync', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = performanceScopeSchema.pick({ clientId: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Empresa inválida.'));
    const client = await ensureSyncClient(user, parsed.data.clientId, reply);
    if (!client) return;

    const master = await prisma.syncJob.create({
      data: { organizationId: user.organizationId!, clientId: client.id, type: 'history_full', status: 'running', createdBy: user.id },
    });

    setImmediate(async () => {
      try {
        const result = await runSync(user.organizationId!, client.id, user.id, 'history', { fullHistory: true });
        await prisma.syncJob.update({
          where: { id: master.id },
          data: { status: 'success', finishedAt: new Date(), recordsProcessed: result.processed },
        });
      } catch (error: any) {
        await prisma.syncJob.update({
          where: { id: master.id },
          data: { status: 'error', finishedAt: new Date(), errorMessage: error?.message ?? 'Erro na importação histórica.' },
        }).catch(() => undefined);
      }
    });

    return reply.code(202).send(ok({ jobId: master.id, clientId: client.id }, 'Importação do histórico completo iniciada.'));
  });

  app.post('/performance/history-sync-all', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const user = req.user as AuthUser;
    if (!adminRoles.has(user.role)) return reply.code(403).send(fail('FORBIDDEN', 'Apenas administradores podem importar todas as empresas.'));

    const clients = await prisma.client.findMany({
      where: {
        organizationId: user.organizationId!,
        adAccounts: { some: { isActive: true, isAssigned: true } },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (!clients.length) return reply.code(409).send(fail('NO_ASSIGNED_META_ACCOUNTS', 'Nenhuma empresa possui conta Meta autorizada.'));

    const master = await prisma.syncJob.create({
      data: { organizationId: user.organizationId!, type: 'history_all', status: 'running', createdBy: user.id },
    });

    setImmediate(async () => {
      let processed = 0;
      const errors: string[] = [];
      for (const client of clients) {
        try {
          const result = await runSync(user.organizationId!, client.id, user.id, 'history', { fullHistory: true });
          processed += result.processed;
        } catch (error: any) {
          errors.push(`${client.name}: ${error?.message ?? 'falha'}`);
        }
      }
      await prisma.syncJob.update({
        where: { id: master.id },
        data: {
          status: errors.length === clients.length ? 'error' : 'success',
          finishedAt: new Date(),
          recordsProcessed: processed,
          errorMessage: errors.length ? errors.slice(0, 20).join(' | ') : null,
        },
      }).catch(() => undefined);
    });

    return reply.code(202).send(ok({ jobId: master.id, clients: clients.length }, 'Importação histórica de todas as empresas iniciada.'));
  });
}
