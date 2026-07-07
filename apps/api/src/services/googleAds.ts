import axios from 'axios';
import { Platform } from '@prisma/client';
import { env } from '../env.js';
import { normalizeMetric } from './normalizer.js';
import type { NormalizedCampaignMetric } from './types.js';

function cleanCustomerId(customerId: string) {
  return customerId.replace(/-/g, '').trim();
}

export function googleAuthUrl(state: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_ADS_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.GOOGLE_ADS_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGoogleCode(code: string) {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    code,
    client_id: env.GOOGLE_ADS_CLIENT_ID,
    client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_ADS_REDIRECT_URI,
    grant_type: 'authorization_code'
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return data as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_ADS_CLIENT_ID,
    client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
    grant_type: 'refresh_token'
  }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return data as { access_token: string; expires_in?: number; scope?: string };
}

function googleHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
    ...(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { 'login-customer-id': cleanCustomerId(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) } : {})
  };
}

export async function listGoogleAccessibleCustomers(refreshToken: string) {
  const { access_token: accessToken } = await refreshGoogleAccessToken(refreshToken);
  const { data } = await axios.get(`https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, {
    headers: googleHeaders(accessToken)
  });
  return (data.resourceNames || []).map((resourceName: string) => {
    const id = resourceName.split('/').pop() || resourceName;
    return { externalAccountId: id, accountName: `Google Ads ${id}`, currency: null, timezone: null, status: 'active' };
  });
}

export async function fetchGoogleCampaignInsights(input: {
  refreshToken: string;
  customerId: string;
  from: string;
  to: string;
}): Promise<NormalizedCampaignMetric[]> {
  const { access_token: accessToken } = await refreshGoogleAccessToken(input.refreshToken);
  const customerId = cleanCustomerId(input.customerId);
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.average_cpm,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM campaign
    WHERE segments.date BETWEEN '${input.from}' AND '${input.to}'
  `;

  const { data } = await axios.post(
    `https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    { query },
    { headers: googleHeaders(accessToken) }
  );

  const rows: NormalizedCampaignMetric[] = [];
  for (const batch of Array.isArray(data) ? data : []) {
    for (const result of batch.results || []) {
      const spend = Number(result.metrics?.costMicros || 0) / 1_000_000;
      const purchaseValue = Number(result.metrics?.conversionsValue || 0);
      rows.push(normalizeMetric({
        platform: Platform.GOOGLE,
        adAccountExternalId: customerId,
        campaignExternalId: String(result.campaign?.id),
        campaignName: result.campaign?.name || 'Campanha Google Ads',
        objective: result.campaign?.advertisingChannelType || null,
        status: result.campaign?.status || null,
        effectiveStatus: result.campaign?.status || null,
        date: result.segments?.date,
        spend,
        impressions: Number(result.metrics?.impressions || 0),
        clicks: Number(result.metrics?.clicks || 0),
        ctr: Number(result.metrics?.ctr || 0) * 100,
        cpc: Number(result.metrics?.averageCpc || 0) / 1_000_000,
        cpm: Number(result.metrics?.averageCpm || 0) / 1_000_000,
        conversions: Number(result.metrics?.conversions || 0),
        purchaseValue,
        roas: spend > 0 && purchaseValue > 0 ? purchaseValue / spend : null,
        rawPayload: result
      }));
    }
  }

  return rows;
}
