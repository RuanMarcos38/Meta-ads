import type { NormalizedCampaignMetric } from './types.js';

function round(value: number, places = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function safeDivide(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function numberish(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeMetric(metric: NormalizedCampaignMetric): NormalizedCampaignMetric {
  const spend = round(numberish(metric.spend), 2);
  const impressions = Math.max(0, Math.round(numberish(metric.impressions)));
  const clicks = Math.max(0, Math.round(numberish(metric.clicks)));
  const conversions = round(numberish(metric.conversions), 4);
  const primaryResults = conversions || numberish(metric.leads) || numberish(metric.messages) || numberish(metric.purchases);
  const purchaseValue = metric.purchaseValue == null ? null : round(numberish(metric.purchaseValue), 2);

  return {
    ...metric,
    spend,
    impressions,
    clicks,
    reach: metric.reach == null ? null : Math.max(0, Math.round(numberish(metric.reach))),
    frequency: metric.frequency == null ? null : round(numberish(metric.frequency), 4),
    linkClicks: metric.linkClicks == null ? null : Math.max(0, Math.round(numberish(metric.linkClicks))),
    ctr: round(metric.ctr ?? safeDivide(clicks, impressions) * 100, 4),
    cpc: round(metric.cpc ?? safeDivide(spend, clicks), 4),
    cpm: round(metric.cpm ?? safeDivide(spend, impressions) * 1000, 4),
    conversions,
    leads: metric.leads == null ? null : round(numberish(metric.leads), 4),
    messages: metric.messages == null ? null : round(numberish(metric.messages), 4),
    purchases: metric.purchases == null ? null : round(numberish(metric.purchases), 4),
    purchaseValue,
    costPerResult: round(metric.costPerResult ?? safeDivide(spend, primaryResults), 4),
    roas: metric.roas ?? (purchaseValue ? round(safeDivide(purchaseValue, spend), 4) : null)
  };
}
