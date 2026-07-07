import { IntegrationStatus, Platform, SyncStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { decryptSecret } from '../utils/crypto.js';
import { fetchMetaCampaignInsights } from './metaAds.js';
import { fetchGoogleCampaignInsights } from './googleAds.js';
import { generateDemoCampaigns } from './demoData.js';
import { logAudit, logSync } from './audit.js';
import type { NormalizedCampaignMetric } from './types.js';

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null));
}

function lockKey(input: { tenantId: string; clientId: string; adAccountId?: string; platform?: Platform; from: string; to: string }) {
  return [input.tenantId, input.clientId, input.adAccountId || 'client', input.platform || 'all', input.from, input.to].join(':');
}

export async function syncClientMetrics(input: {
  tenantId: string;
  clientId: string;
  platform?: Platform;
  from: string;
  to: string;
  requestedBy?: string;
}) {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, tenantId: input.tenantId },
    select: { id: true, tenantId: true, name: true }
  });
  if (!client) throw Object.assign(new Error('Cliente nao encontrado.'), { statusCode: 404 });

  const key = lockKey(input);
  const recent = new Date(Date.now() - 30 * 60 * 1000);
  const running = await prisma.platformSyncJob.findFirst({
    where: { lockKey: key, status: SyncStatus.RUNNING, startedAt: { gte: recent } }
  });
  if (running) return { jobId: running.id, status: running.status, message: 'Sincronizacao ja em andamento.' };

  const job = await prisma.platformSyncJob.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      platform: input.platform,
      lockKey: key,
      fromDate: parseDateOnly(input.from),
      toDate: parseDateOnly(input.to),
      status: SyncStatus.RUNNING,
      startedAt: new Date()
    }
  });

  try {
    const accounts = await ensureSyncAccounts(input.tenantId, input.clientId, input.platform);
    let campaignsSynced = 0;
    let metricsSynced = 0;

    for (const account of accounts) {
      const metrics = await loadAccountMetrics({
        tenantId: input.tenantId,
        clientId: input.clientId,
        platform: account.platform,
        adAccountExternalId: account.externalAccountId,
        adAccountName: account.accountName,
        from: input.from,
        to: input.to
      });
      const result = await saveMetrics({
        tenantId: input.tenantId,
        clientId: input.clientId,
        adAccountId: account.id,
        metrics
      });
      campaignsSynced += result.campaignsSynced;
      metricsSynced += result.metricsSynced;
      await prisma.adAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date() } });
    }

    await prisma.platformSyncJob.update({
      where: { id: job.id },
      data: { status: SyncStatus.SUCCESS, finishedAt: new Date(), campaignsSynced, metricsSynced }
    });
    await logSync({ tenantId: input.tenantId, clientId: input.clientId, platform: input.platform, message: 'Sincronizacao concluida.', metadata: { campaignsSynced, metricsSynced } });
    if (input.requestedBy) {
      await logAudit({ tenantId: input.tenantId, userId: input.requestedBy, action: 'sync.manual', entity: 'client', entityId: input.clientId, metadata: { from: input.from, to: input.to, platform: input.platform } });
    }
    return { jobId: job.id, status: SyncStatus.SUCCESS, campaignsSynced, metricsSynced };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido na sincronizacao.';
    await prisma.platformSyncJob.update({
      where: { id: job.id },
      data: { status: SyncStatus.ERROR, finishedAt: new Date(), errorMessage: message }
    });
    await logSync({ tenantId: input.tenantId, clientId: input.clientId, platform: input.platform, level: 'error', message, metadata: { jobId: job.id } });
    throw error;
  }
}

export async function syncAdAccountMetrics(input: {
  tenantId: string;
  adAccountId: string;
  from: string;
  to: string;
  requestedBy?: string;
}) {
  const account = await prisma.adAccount.findFirst({ where: { id: input.adAccountId, tenantId: input.tenantId } });
  if (!account) throw Object.assign(new Error('Conta de anuncio nao encontrada.'), { statusCode: 404 });
  return syncClientMetrics({
    tenantId: input.tenantId,
    clientId: account.clientId,
    platform: account.platform,
    from: input.from,
    to: input.to,
    requestedBy: input.requestedBy
  });
}

async function ensureSyncAccounts(tenantId: string, clientId: string, platform?: Platform) {
  let accounts = await prisma.adAccount.findMany({
    where: { tenantId, clientId, status: 'active', ...(platform ? { platform } : {}) },
    orderBy: { createdAt: 'asc' }
  });

  if (!accounts.length && env.DEMO_MODE) {
    const platforms = platform ? [platform] : [Platform.META, Platform.GOOGLE];
    for (const item of platforms) {
      const account = await prisma.adAccount.upsert({
        where: { platform_externalAccountId_clientId: { platform: item, externalAccountId: `demo-${item.toLowerCase()}-${clientId}`, clientId } },
        create: {
          tenantId,
          clientId,
          platform: item,
          externalAccountId: `demo-${item.toLowerCase()}-${clientId}`,
          accountName: `${item === Platform.META ? 'Meta' : 'Google'} Demo`,
          currency: 'BRL',
          status: 'active'
        },
        update: { status: 'active' }
      });
      accounts.push(account);
    }
  }

  if (!accounts.length) {
    await logSync({ tenantId, clientId, platform, level: 'warn', message: 'Nenhuma conta de anuncio conectada para sincronizacao.' });
  }

  return accounts;
}

async function loadAccountMetrics(input: {
  tenantId: string;
  clientId: string;
  platform: Platform;
  adAccountExternalId: string;
  adAccountName: string;
  from: string;
  to: string;
}) {
  if (env.DEMO_MODE) {
    return generateDemoCampaigns(input.platform, input.adAccountName, input.adAccountExternalId);
  }

  const integration = await prisma.integration.findFirst({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      platform: input.platform,
      status: IntegrationStatus.CONNECTED
    },
    orderBy: { updatedAt: 'desc' }
  });
  if (!integration) {
    await logSync({ tenantId: input.tenantId, clientId: input.clientId, platform: input.platform, level: 'warn', message: 'Integracao nao conectada.' });
    return [];
  }

  if (input.platform === Platform.META) {
    const token = decryptSecret(integration.accessTokenEncrypted);
    if (!token) throw new Error('Token Meta Ads ausente.');
    return fetchMetaCampaignInsights({ accessToken: token, adAccountId: input.adAccountExternalId, from: input.from, to: input.to });
  }

  const refreshToken = decryptSecret(integration.refreshTokenEncrypted);
  if (!refreshToken) throw new Error('Refresh token Google Ads ausente.');
  return fetchGoogleCampaignInsights({ refreshToken, customerId: input.adAccountExternalId, from: input.from, to: input.to });
}

async function saveMetrics(input: {
  tenantId: string;
  clientId: string;
  adAccountId: string;
  metrics: NormalizedCampaignMetric[];
}) {
  const campaignIds = new Set<string>();
  let metricsSynced = 0;

  for (const metric of input.metrics) {
    const campaign = await prisma.campaign.upsert({
      where: {
        platform_externalCampaignId_adAccountId: {
          platform: metric.platform,
          externalCampaignId: metric.campaignExternalId,
          adAccountId: input.adAccountId
        }
      },
      create: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        adAccountId: input.adAccountId,
        platform: metric.platform,
        externalCampaignId: metric.campaignExternalId,
        name: metric.campaignName,
        objective: metric.objective,
        status: metric.status,
        effectiveStatus: metric.effectiveStatus
      },
      update: {
        name: metric.campaignName,
        objective: metric.objective,
        status: metric.status,
        effectiveStatus: metric.effectiveStatus
      }
    });
    campaignIds.add(campaign.id);

    await prisma.campaignDailyMetric.upsert({
      where: {
        campaignId_date_platform: {
          campaignId: campaign.id,
          date: parseDateOnly(metric.date),
          platform: metric.platform
        }
      },
      create: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        adAccountId: input.adAccountId,
        campaignId: campaign.id,
        platform: metric.platform,
        date: parseDateOnly(metric.date),
        spend: metric.spend,
        impressions: metric.impressions,
        reach: metric.reach,
        frequency: metric.frequency,
        clicks: metric.clicks,
        linkClicks: metric.linkClicks,
        ctr: metric.ctr ?? 0,
        cpc: metric.cpc ?? 0,
        cpm: metric.cpm ?? 0,
        conversions: metric.conversions ?? 0,
        leads: metric.leads,
        messages: metric.messages,
        purchases: metric.purchases,
        purchaseValue: metric.purchaseValue,
        costPerResult: metric.costPerResult ?? 0,
        roas: metric.roas,
        rawPayload: json(metric.rawPayload)
      },
      update: {
        spend: metric.spend,
        impressions: metric.impressions,
        reach: metric.reach,
        frequency: metric.frequency,
        clicks: metric.clicks,
        linkClicks: metric.linkClicks,
        ctr: metric.ctr ?? 0,
        cpc: metric.cpc ?? 0,
        cpm: metric.cpm ?? 0,
        conversions: metric.conversions ?? 0,
        leads: metric.leads,
        messages: metric.messages,
        purchases: metric.purchases,
        purchaseValue: metric.purchaseValue,
        costPerResult: metric.costPerResult ?? 0,
        roas: metric.roas,
        rawPayload: json(metric.rawPayload)
      }
    });
    metricsSynced += 1;
  }

  return { campaignsSynced: campaignIds.size, metricsSynced };
}
