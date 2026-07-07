import type { Platform } from '@prisma/client';

export type NormalizedCampaignMetric = {
  platform: Platform;
  adAccountExternalId: string;
  adAccountName?: string | null;
  campaignExternalId: string;
  campaignName: string;
  objective?: string | null;
  status?: string | null;
  effectiveStatus?: string | null;
  date: string;
  spend: number;
  impressions: number;
  reach?: number | null;
  frequency?: number | null;
  clicks: number;
  linkClicks?: number | null;
  ctr?: number | null;
  cpc?: number | null;
  cpm?: number | null;
  conversions?: number | null;
  leads?: number | null;
  messages?: number | null;
  purchases?: number | null;
  purchaseValue?: number | null;
  costPerResult?: number | null;
  roas?: number | null;
  rawPayload?: unknown;
};

export type SyncPeriod = {
  from: string;
  to: string;
};
