import { prisma } from '../../shared/prisma.js';
import { decrypt } from '../../shared/crypto.js';
import { MetaAdsService, type MetaBusinessRef, type MetaInsightLevel } from './MetaAdsService.js';
import { mapMetaActions, mapMetaActionValues } from './metaActions.js';
import dayjs from 'dayjs';

export type SyncJobType = 'manual' | 'automatic' | 'oauth';
export type SyncPeriod = { since?: string; until?: string };

function resolvePeriod(jobType: SyncJobType, period?: SyncPeriod) {
  const until = period?.until && dayjs(period.until).isValid() ? dayjs(period.until) : dayjs();
  const defaultDays = jobType === 'automatic' ? 3 : 30;
  const since = period?.since && dayjs(period.since).isValid() ? dayjs(period.since) : until.subtract(defaultDays, 'day');
  const boundedSince = since.isAfter(until) ? until : since;
  return {
    since: boundedSince.format('YYYY-MM-DD'),
    until: until.format('YYYY-MM-DD'),
  };
}

export async function runSync(
  organizationId: string,
  clientId: string | undefined,
  userId?: string,
  jobType: SyncJobType = 'manual',
  period?: SyncPeriod,
) {
  const job = await prisma.syncJob.create({
    data: { organizationId, clientId, type: jobType, status: 'running', createdBy: userId },
  });

  try {
    // Regra multiempresa: somente contas ativas e explicitamente vinculadas ao cliente
    // podem alimentar campanhas, conjuntos, anúncios, insights e dashboards.
    const accounts = await prisma.metaAdAccount.findMany({
      where: {
        organizationId,
        ...(clientId ? { clientId } : {}),
        isActive: true,
        isAssigned: true,
      },
      include: { connection: true },
    });

    let processed = 0;
    const { since, until } = resolvePeriod(jobType, period);
    const businessMaps = new Map<string, Map<string, MetaBusinessRef>>();

    for (const acc of accounts) {
      if (acc.connection.organizationId !== organizationId) {
        throw new Error('Conexão Meta não pertence à organização autenticada.');
      }
      if (acc.connection.status !== 'active') continue;
      if (clientId && acc.clientId !== clientId) {
        throw new Error('Conta de anúncio não pertence ao cliente autenticado.');
      }

      const token = decrypt(acc.connection.accessTokenEncrypted);
      const meta = new MetaAdsService(token);

      if (!businessMaps.has(acc.connectionId)) {
        try {
          businessMaps.set(acc.connectionId, await meta.businessAdAccountMap());
        } catch {
          businessMaps.set(acc.connectionId, new Map());
        }
      }

      const normalizedAccountId = String(acc.accountId).replace(/^act_/, '');
      const business = businessMaps.get(acc.connectionId)?.get(normalizedAccountId);
      if (business && (acc.businessId !== business.businessId || acc.businessName !== business.businessName)) {
        await prisma.metaAdAccount.update({
          where: { id: acc.id },
          data: {
            businessId: business.businessId,
            businessName: business.businessName,
          },
        });
      }

      const metaAccountId = acc.accountId.startsWith('act_') ? acc.accountId : `act_${acc.accountId}`;
      const campaignMap = new Map<string, string>();
      const adSetMap = new Map<string, { id: string; campaignId: string }>();

      const campaigns = await meta.campaigns(metaAccountId);
      for (const campaign of campaigns) {
        const saved = await prisma.campaign.upsert({
          where: {
            adAccountId_metaCampaignId: {
              adAccountId: acc.id,
              metaCampaignId: campaign.id,
            },
          },
          update: {
            name: campaign.name,
            objective: campaign.objective,
            status: campaign.status,
            effectiveStatus: campaign.effective_status,
            buyingType: campaign.buying_type,
            dailyBudget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
            lifetimeBudget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
            startTime: campaign.start_time ? new Date(campaign.start_time) : null,
            stopTime: campaign.stop_time ? new Date(campaign.stop_time) : null,
          },
          create: {
            organizationId,
            clientId: acc.clientId,
            adAccountId: acc.id,
            metaCampaignId: campaign.id,
            name: campaign.name,
            objective: campaign.objective,
            status: campaign.status,
            effectiveStatus: campaign.effective_status,
            buyingType: campaign.buying_type,
            dailyBudget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
            lifetimeBudget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
            startTime: campaign.start_time ? new Date(campaign.start_time) : null,
            stopTime: campaign.stop_time ? new Date(campaign.stop_time) : null,
          },
          select: { id: true, metaCampaignId: true },
        });
        campaignMap.set(saved.metaCampaignId, saved.id);
      }

      const adSets = await meta.adSets(metaAccountId);
      for (const adSet of adSets) {
        const internalCampaignId = campaignMap.get(String(adSet.campaign_id || ''));
        if (!internalCampaignId) continue;
        const saved = await prisma.adSet.upsert({
          where: {
            campaignId_metaAdsetId: {
              campaignId: internalCampaignId,
              metaAdsetId: adSet.id,
            },
          },
          update: {
            name: adSet.name,
            status: adSet.status,
            effectiveStatus: adSet.effective_status,
            dailyBudget: adSet.daily_budget ? Number(adSet.daily_budget) / 100 : null,
            lifetimeBudget: adSet.lifetime_budget ? Number(adSet.lifetime_budget) / 100 : null,
            optimizationGoal: adSet.optimization_goal,
            billingEvent: adSet.billing_event,
          },
          create: {
            campaignId: internalCampaignId,
            metaAdsetId: adSet.id,
            name: adSet.name,
            status: adSet.status,
            effectiveStatus: adSet.effective_status,
            dailyBudget: adSet.daily_budget ? Number(adSet.daily_budget) / 100 : null,
            lifetimeBudget: adSet.lifetime_budget ? Number(adSet.lifetime_budget) / 100 : null,
            optimizationGoal: adSet.optimization_goal,
            billingEvent: adSet.billing_event,
          },
          select: { id: true, campaignId: true, metaAdsetId: true },
        });
        adSetMap.set(saved.metaAdsetId, { id: saved.id, campaignId: saved.campaignId });
      }

      const ads = await meta.ads(metaAccountId);
      for (const ad of ads) {
        const internalAdSet = adSetMap.get(String(ad.adset_id || ''));
        if (!internalAdSet) continue;
        await prisma.ad.upsert({
          where: {
            adSetId_metaAdId: {
              adSetId: internalAdSet.id,
              metaAdId: ad.id,
            },
          },
          update: {
            campaignId: internalAdSet.campaignId,
            name: ad.name,
            status: ad.status,
            effectiveStatus: ad.effective_status,
            creativeId: ad.creative?.id ? String(ad.creative.id) : null,
          },
          create: {
            adSetId: internalAdSet.id,
            campaignId: internalAdSet.campaignId,
            metaAdId: ad.id,
            name: ad.name,
            status: ad.status,
            effectiveStatus: ad.effective_status,
            creativeId: ad.creative?.id ? String(ad.creative.id) : null,
          },
        });
      }

      const levels: MetaInsightLevel[] = ['campaign', 'adset', 'ad'];
      for (const level of levels) {
        const insights = await meta.insights(metaAccountId, since, until, level);
        for (const insight of insights) {
          const mapped = mapMetaActions(insight.actions);
          const values = mapMetaActionValues(insight.action_values);
          const spend = Number(insight.spend || 0);
          const metrics = {
            spend,
            impressions: Number(insight.impressions || 0),
            reach: Number(insight.reach || 0),
            frequency: Number(insight.frequency || 0),
            clicks: Number(insight.clicks || 0),
            inlineLinkClicks: Number(insight.inline_link_clicks || 0),
            ctr: Number(insight.ctr || 0),
            cpc: Number(insight.cpc || 0),
            cpm: Number(insight.cpm || 0),
            leads: mapped.leads,
            conversations: mapped.conversations,
            purchases: mapped.purchases,
            revenue: values.purchaseValue,
            costPerLead: mapped.leads ? spend / mapped.leads : 0,
            costPerConversation: mapped.conversations ? spend / mapped.conversations : 0,
            rawActionsJson: insight.actions ?? undefined,
            rawCostPerActionJson: insight.cost_per_action_type ?? undefined,
          };

          const campaignId = String(insight.campaign_id || '');
          const adSetId = level === 'campaign' ? '' : String(insight.adset_id || '');
          const adId = level === 'ad' ? String(insight.ad_id || '') : '';
          if (!campaignId) continue;
          if (level !== 'campaign' && !adSetId) continue;
          if (level === 'ad' && !adId) continue;

          await prisma.insightDaily.upsert({
            where: {
              level_date_adAccountId_campaignId_adSetId_adId: {
                level,
                date: new Date(insight.date_start),
                adAccountId: acc.id,
                campaignId,
                adSetId,
                adId,
              },
            },
            update: metrics,
            create: {
              organizationId,
              clientId: acc.clientId,
              adAccountId: acc.id,
              campaignId,
              adSetId,
              adId,
              level,
              date: new Date(insight.date_start),
              ...metrics,
            },
          });
          processed += 1;
        }
      }
    }

    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: 'success', finishedAt: new Date(), recordsProcessed: processed },
    });
    return { jobId: job.id, processed, accounts: accounts.length, since, until };
  } catch (error: any) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: 'error',
        finishedAt: new Date(),
        errorMessage: error?.message ?? 'Erro de sincronização',
      },
    });
    throw error;
  }
}
