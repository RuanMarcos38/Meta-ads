import { prisma } from '../../shared/prisma.js';
import { decrypt } from '../../shared/crypto.js';
import { MetaAdsService } from './MetaAdsService.js';
import { mapMetaActions } from './metaActions.js';
import dayjs from 'dayjs';

// Dispara sincronização real das contas Meta de um cliente
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
      const token = decrypt(acc.connection.accessTokenEncrypted);
      const meta = new MetaAdsService(token);

      const metaAccountId = acc.accountId.startsWith('act_') ? acc.accountId : `act_${acc.accountId}`;
      const campaigns = await meta.campaigns(metaAccountId);
      for (const c of campaigns) {
        await prisma.campaign.upsert({
          where: { adAccountId_metaCampaignId: { adAccountId: acc.id, metaCampaignId: c.id } },
          update: { name: c.name, objective: c.objective, status: c.status, effectiveStatus: c.effective_status,
            dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
            lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null },
          create: { organizationId, clientId: acc.clientId, adAccountId: acc.id, metaCampaignId: c.id,
            name: c.name, objective: c.objective, status: c.status, effectiveStatus: c.effective_status },
        });
      }

      const insights = await meta.insights(metaAccountId, since, until, 'campaign');
      for (const ins of insights) {
        const m = mapMetaActions(ins.actions);
        const spend = Number(ins.spend || 0);
        await prisma.insightDaily.upsert({
          where: { level_date_adAccountId_campaignId_adSetId_adId: {
            level: 'campaign', date: new Date(ins.date_start), adAccountId: acc.id,
            campaignId: ins.campaign_id, adSetId: '', adId: '' } },
          update: {}, // simplificado
          create: {
            organizationId, clientId: acc.clientId, adAccountId: acc.id, campaignId: ins.campaign_id,
            adSetId: '', adId: '', level: 'campaign', date: new Date(ins.date_start),
            spend, impressions: Number(ins.impressions || 0), reach: Number(ins.reach || 0),
            frequency: Number(ins.frequency || 0), clicks: Number(ins.clicks || 0),
            inlineLinkClicks: Number(ins.inline_link_clicks || 0), ctr: Number(ins.ctr || 0),
            cpc: Number(ins.cpc || 0), cpm: Number(ins.cpm || 0),
            leads: m.leads, conversations: m.conversations, purchases: m.purchases,
            costPerLead: m.leads ? spend / m.leads : 0,
            costPerConversation: m.conversations ? spend / m.conversations : 0,
            rawActionsJson: ins.actions ?? undefined,
            rawCostPerActionJson: ins.cost_per_action_type ?? undefined,
          },
        }).catch(() => {});
        processed++;
      }
    }

    await prisma.syncJob.update({ where: { id: job.id },
      data: { status: 'success', finishedAt: new Date(), recordsProcessed: processed } });
    return { jobId: job.id, processed };
  } catch (e: any) {
    await prisma.syncJob.update({ where: { id: job.id },
      data: { status: 'error', finishedAt: new Date(), errorMessage: e?.message ?? 'erro' } });
    throw e;
  }
}
