import { prisma } from '../../shared/prisma.js';
import { decrypt } from '../../shared/crypto.js';
import { MetaAdsService } from './MetaAdsService.js';
import { mapMetaActions } from './metaActions.js';
import dayjs from 'dayjs';

// Dispara sincronização real das contas Meta de um cliente.
export async function runSync(organizationId: string, clientId: string | undefined, userId?: string) {
  const job = await prisma.syncJob.create({
    data: { organizationId, clientId, type: 'manual', status: 'running', createdBy: userId },
  });

  try {
    const accounts = await prisma.metaAdAccount.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}), isActive: true },
      include: { connection: true },
    });

    let processed = 0;
    const since = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    const until = dayjs().format('YYYY-MM-DD');

    for (const acc of accounts) {
      if (acc.connection.organizationId !== organizationId) {
        throw new Error('Conexão Meta não pertence à organização autenticada.');
      }
      if (clientId && acc.clientId !== clientId) {
        throw new Error('Conta de anúncio não pertence ao cliente autenticado.');
      }

      const token = decrypt(acc.connection.accessTokenEncrypted);
      const meta = new MetaAdsService(token);
      const metaAccountId = acc.accountId.startsWith('act_') ? acc.accountId : `act_${acc.accountId}`;

      const campaigns = await meta.campaigns(metaAccountId);
      for (const campaign of campaigns) {
        await prisma.campaign.upsert({
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
            dailyBudget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
            lifetimeBudget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
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
            dailyBudget: campaign.daily_budget ? Number(campaign.daily_budget) / 100 : null,
            lifetimeBudget: campaign.lifetime_budget ? Number(campaign.lifetime_budget) / 100 : null,
          },
        });
      }

      const insights = await meta.insights(metaAccountId, since, until, 'campaign');
      for (const insight of insights) {
        const mapped = mapMetaActions(insight.actions);
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
          costPerLead: mapped.leads ? spend / mapped.leads : 0,
          costPerConversation: mapped.conversations ? spend / mapped.conversations : 0,
          rawActionsJson: insight.actions ?? undefined,
          rawCostPerActionJson: insight.cost_per_action_type ?? undefined,
        };

        await prisma.insightDaily.upsert({
          where: {
            level_date_adAccountId_campaignId_adSetId_adId: {
              level: 'campaign',
              date: new Date(insight.date_start),
              adAccountId: acc.id,
              campaignId: insight.campaign_id,
              adSetId: '',
              adId: '',
            },
          },
          update: metrics,
          create: {
            organizationId,
            clientId: acc.clientId,
            adAccountId: acc.id,
            campaignId: insight.campaign_id,
            adSetId: '',
            adId: '',
            level: 'campaign',
            date: new Date(insight.date_start),
            ...metrics,
          },
        });
        processed += 1;
      }
    }

    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: 'success', finishedAt: new Date(), recordsProcessed: processed },
    });
    return { jobId: job.id, processed, accounts: accounts.length };
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
