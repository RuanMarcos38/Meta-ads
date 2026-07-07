import { Platform, Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type PeriodInput = {
  tenantId: string;
  clientId?: string;
  from: Date;
  to: Date;
  platform?: Platform;
};

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildWhere(input: PeriodInput): Prisma.CampaignDailyMetricWhereInput {
  return {
    tenantId: input.tenantId,
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
    date: { gte: input.from, lte: input.to }
  };
}

function aggregateTotals(rows: any[]) {
  const totals = rows.reduce((acc, row) => {
    acc.spend += number(row.spend);
    acc.impressions += number(row.impressions);
    acc.reach += number(row.reach);
    acc.clicks += number(row.clicks);
    acc.linkClicks += number(row.linkClicks);
    acc.conversions += number(row.conversions);
    acc.leads += number(row.leads);
    acc.messages += number(row.messages);
    acc.purchases += number(row.purchases);
    acc.purchaseValue += number(row.purchaseValue);
    return acc;
  }, {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    linkClicks: 0,
    conversions: 0,
    leads: 0,
    messages: 0,
    purchases: 0,
    purchaseValue: 0
  });

  const results = totals.conversions || totals.leads + totals.messages + totals.purchases;
  return {
    ...totals,
    results,
    ctr: round(totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0, 2),
    cpc: round(totals.clicks ? totals.spend / totals.clicks : 0, 2),
    cpm: round(totals.impressions ? (totals.spend / totals.impressions) * 1000 : 0, 2),
    costPerResult: round(results ? totals.spend / results : 0, 2),
    roas: round(totals.spend ? totals.purchaseValue / totals.spend : 0, 2),
    spend: round(totals.spend, 2),
    purchaseValue: round(totals.purchaseValue, 2)
  };
}

function executiveSummary(clientName: string | undefined, totals: ReturnType<typeof aggregateTotals>, topCampaign?: string) {
  if (!totals.spend && !totals.results) {
    return 'Nenhum dado de campanha foi encontrado para este periodo. Conecte as contas de anuncios ou altere os filtros.';
  }
  const best = topCampaign ? ` A campanha com maior volume foi ${topCampaign}.` : '';
  return `Neste periodo, ${clientName || 'as campanhas'} investiram R$ ${totals.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} e geraram ${Math.round(totals.results).toLocaleString('pt-BR')} resultados, com custo medio de R$ ${totals.costPerResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} por resultado.${best}`;
}

export async function getDashboardSummary(input: PeriodInput) {
  const clients = await prisma.client.findMany({
    where: { tenantId: input.tenantId, ...(input.clientId ? { id: input.clientId } : {}) },
    select: { id: true, name: true, tradeName: true }
  });
  const rows = await prisma.campaignDailyMetric.findMany({
    where: buildWhere(input),
    include: { campaign: true, adAccount: true, client: true },
    orderBy: [{ date: 'desc' }, { spend: 'desc' }]
  });
  const totals = aggregateTotals(rows);
  const campaigns = aggregateCampaigns(rows);
  const lastSync = await prisma.adAccount.aggregate({
    where: {
      tenantId: input.tenantId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.platform ? { platform: input.platform } : {})
    },
    _max: { lastSyncAt: true }
  });

  return {
    period: { from: isoDate(input.from), to: isoDate(input.to) },
    clients,
    totals,
    summary: executiveSummary(clients[0]?.tradeName || clients[0]?.name, totals, campaigns[0]?.campaignName),
    lastSyncAt: lastSync._max.lastSyncAt,
    campaigns
  };
}

export function aggregateCampaigns(rows: any[]) {
  const grouped = new Map<string, any>();
  for (const row of rows) {
    const key = `${row.platform}:${row.campaignId}`;
    const current = grouped.get(key) ?? {
      platform: row.platform,
      campaignId: row.campaignId,
      campaignExternalId: row.campaign.externalCampaignId,
      campaignName: row.campaign.name,
      clientId: row.clientId,
      clientName: row.client.name,
      adAccountName: row.adAccount.accountName,
      status: row.campaign.effectiveStatus || row.campaign.status || 'UNKNOWN',
      objective: row.campaign.objective,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      conversions: 0,
      results: 0,
      purchaseValue: 0
    };
    current.spend += number(row.spend);
    current.impressions += number(row.impressions);
    current.reach += number(row.reach);
    current.clicks += number(row.clicks);
    current.conversions += number(row.conversions);
    current.results += number(row.conversions) || number(row.leads) + number(row.messages) + number(row.purchases);
    current.purchaseValue += number(row.purchaseValue);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((item) => ({
      ...item,
      spend: round(item.spend, 2),
      ctr: round(item.impressions ? (item.clicks / item.impressions) * 100 : 0, 2),
      cpc: round(item.clicks ? item.spend / item.clicks : 0, 2),
      cpm: round(item.impressions ? (item.spend / item.impressions) * 1000 : 0, 2),
      costPerResult: round(item.results ? item.spend / item.results : 0, 2),
      roas: round(item.spend ? item.purchaseValue / item.spend : 0, 2)
    }))
    .sort((a, b) => b.spend - a.spend);
}

export async function getDailyMetrics(input: PeriodInput) {
  const rows = await prisma.campaignDailyMetric.findMany({
    where: buildWhere(input),
    orderBy: { date: 'asc' }
  });
  const grouped = new Map<string, any>();
  for (const row of rows) {
    const key = isoDate(row.date);
    const current = grouped.get(key) ?? { date: key, spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0 };
    current.spend += number(row.spend);
    current.impressions += row.impressions;
    current.reach += number(row.reach);
    current.clicks += row.clicks;
    current.results += number(row.conversions) || number(row.leads) + number(row.messages) + number(row.purchases);
    grouped.set(key, current);
  }
  return { daily: [...grouped.values()].map((item) => ({ ...item, spend: round(item.spend, 2) })) };
}

export async function getCampaigns(input: PeriodInput) {
  const rows = await prisma.campaignDailyMetric.findMany({
    where: buildWhere(input),
    include: { campaign: true, adAccount: true, client: true },
    orderBy: { spend: 'desc' }
  });
  return { campaigns: aggregateCampaigns(rows) };
}

export async function getPlatformDistribution(input: Omit<PeriodInput, 'platform'>) {
  const rows = await prisma.campaignDailyMetric.findMany({
    where: buildWhere(input),
    orderBy: { spend: 'desc' }
  });
  const totals = aggregateTotals(rows);
  const grouped = new Map<Platform, { platform: Platform; spend: number; results: number }>();
  for (const row of rows) {
    const current = grouped.get(row.platform) ?? { platform: row.platform, spend: 0, results: 0 };
    current.spend += number(row.spend);
    current.results += number(row.conversions) || number(row.leads) + number(row.messages) + number(row.purchases);
    grouped.set(row.platform, current);
  }
  return {
    distribution: [...grouped.values()].map((item) => ({
      ...item,
      spend: round(item.spend, 2),
      share: totals.spend ? round((item.spend / totals.spend) * 100, 2) : 0
    }))
  };
}

export async function getTopCampaigns(input: PeriodInput & { limit?: number }) {
  const { campaigns } = await getCampaigns(input);
  return { campaigns: campaigns.slice(0, input.limit ?? 5) };
}

export async function getDashboardHealth(input: { tenantId: string; clientId?: string }) {
  const [accounts, integrations, lastLogs, activeCampaigns] = await Promise.all([
    prisma.adAccount.findMany({
      where: { tenantId: input.tenantId, ...(input.clientId ? { clientId: input.clientId } : {}) },
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.integration.findMany({
      where: { tenantId: input.tenantId, ...(input.clientId ? { clientId: input.clientId } : {}) },
      orderBy: { updatedAt: 'desc' }
    }),
    prisma.syncLog.findMany({
      where: { tenantId: input.tenantId, ...(input.clientId ? { clientId: input.clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 10
    }),
    prisma.campaign.count({
      where: {
        tenantId: input.tenantId,
        ...(input.clientId ? { clientId: input.clientId } : {}),
        effectiveStatus: { in: ['ACTIVE', 'ENABLED'] }
      }
    })
  ]);

  const connected = integrations.filter((item) => item.status === 'CONNECTED').length;
  const score = Math.min(100, Math.round((accounts.length ? 35 : 0) + (connected ? 35 : 0) + (activeCampaigns ? 20 : 0) + 10));
  return { score, accounts, integrations: integrations.map((item) => ({ ...item, accessTokenEncrypted: undefined, refreshTokenEncrypted: undefined })), activeCampaigns, logs: lastLogs };
}
