import { Platform } from '@prisma/client';
import { normalizeMetric } from './normalizer.js';
import type { NormalizedCampaignMetric } from './types.js';

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const demoCampaigns = [
  ['Landing Page Profissional', 'Conversas'],
  ['Automacao WhatsApp IA', 'Conversas'],
  ['CRM com IA para Empresas', 'Leads'],
  ['Remarketing Servicos Digitais', 'Retorno']
] as const;

export function generateDemoCampaigns(platform: Platform, clientName: string, adAccountExternalId: string): NormalizedCampaignMetric[] {
  const platformFactor = platform === Platform.META ? 1 : 0.82;
  const rows: NormalizedCampaignMetric[] = [];

  for (let day = 0; day < 7; day += 1) {
    demoCampaigns.forEach(([name, objective], index) => {
      const base = (index + 1) * 95 * platformFactor;
      const spend = base + day * 14;
      const impressions = Math.round((base * 42 + day * 390) * (index + 1));
      const clicks = Math.round(impressions * (0.024 + index * 0.003));
      const conversions = Math.round(clicks * (0.055 + index * 0.01));
      rows.push(normalizeMetric({
        platform,
        adAccountExternalId,
        adAccountName: `${platform === Platform.META ? 'Meta' : 'Google'} Demo - ${clientName}`,
        campaignExternalId: `demo-${platform.toLowerCase()}-${index + 1}`,
        campaignName: name,
        objective,
        status: index === 3 ? 'PAUSED' : 'ACTIVE',
        effectiveStatus: index === 3 ? 'PAUSED' : 'ACTIVE',
        date: dateDaysAgo(day),
        spend,
        impressions,
        reach: Math.round(impressions * 0.56),
        frequency: 1.8,
        clicks,
        linkClicks: Math.round(clicks * 0.8),
        conversions,
        leads: objective === 'Leads' ? conversions : null,
        messages: objective === 'Conversas' ? conversions : null,
        purchases: null,
        purchaseValue: conversions * 28,
        rawPayload: { demo: true, platform, clientName }
      }));
    });
  }

  return rows;
}
