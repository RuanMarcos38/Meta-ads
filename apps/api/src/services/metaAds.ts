import axios from 'axios';
import { Platform } from '@prisma/client';
import { env } from '../env.js';
import { normalizeMetric } from './normalizer.js';
import type { NormalizedCampaignMetric } from './types.js';

const actionKeys = {
  leads: new Set(['lead', 'onsite_conversion.lead_grouped', 'complete_registration', 'contact']),
  messages: new Set(['messaging_conversation_started_7d', 'onsite_conversion.messaging_conversation_started_7d', 'whatsapp_conversation_started']),
  purchases: new Set(['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'])
};

function graphUrl(path: string) {
  return `https://graph.facebook.com/${env.META_API_VERSION}/${path.replace(/^\//, '')}`;
}

function parseActions(actions: unknown) {
  const totals = { leads: 0, messages: 0, purchases: 0, conversions: 0 };
  if (!Array.isArray(actions)) return totals;

  for (const action of actions as Array<{ action_type?: string; value?: string | number }>) {
    const key = action.action_type || '';
    const value = Number(action.value || 0);
    if (actionKeys.leads.has(key)) totals.leads += value;
    if (actionKeys.messages.has(key)) totals.messages += value;
    if (actionKeys.purchases.has(key)) totals.purchases += value;
  }

  totals.conversions = totals.leads + totals.messages + totals.purchases;
  return totals;
}

function parsePurchaseValue(row: any) {
  const roas = Array.isArray(row.purchase_roas) ? Number(row.purchase_roas[0]?.value || 0) : 0;
  const spend = Number(row.spend || 0);
  return roas && spend ? roas * spend : null;
}

export function metaAuthUrl(state: string) {
  const url = new URL(`https://www.facebook.com/${env.META_API_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', env.META_APP_ID);
  url.searchParams.set('redirect_uri', env.META_REDIRECT_URI);
  url.searchParams.set('scope', 'ads_read,business_management');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeMetaCode(code: string) {
  const { data } = await axios.get(graphUrl('/oauth/access_token'), {
    params: {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: env.META_REDIRECT_URI,
      code
    }
  });
  return data as { access_token: string; token_type?: string; expires_in?: number };
}

export async function listMetaAdAccounts(accessToken: string) {
  const { data } = await axios.get(graphUrl('/me/adaccounts'), {
    params: {
      access_token: accessToken,
      fields: 'account_id,name,currency,timezone_name,account_status'
    }
  });
  return (data.data || []).map((account: any) => ({
    externalAccountId: String(account.account_id || '').replace(/^act_/, ''),
    accountName: account.name || `Conta ${account.account_id}`,
    currency: account.currency || 'BRL',
    timezone: account.timezone_name || null,
    status: String(account.account_status || 'active')
  }));
}

export async function fetchMetaCampaignInsights(input: {
  accessToken: string;
  adAccountId: string;
  from: string;
  to: string;
}): Promise<NormalizedCampaignMetric[]> {
  const accountId = input.adAccountId.startsWith('act_') ? input.adAccountId : `act_${input.adAccountId}`;
  const rows: NormalizedCampaignMetric[] = [];
  let nextUrl: string | null = graphUrl(`/${accountId}/insights`);
  const params: Record<string, unknown> | undefined = {
    access_token: input.accessToken,
    level: 'campaign',
    time_increment: 1,
    time_range: JSON.stringify({ since: input.from, until: input.to }),
    fields: [
      'campaign_id',
      'campaign_name',
      'objective',
      'spend',
      'impressions',
      'reach',
      'frequency',
      'clicks',
      'inline_link_clicks',
      'ctr',
      'cpc',
      'cpm',
      'actions',
      'cost_per_action_type',
      'purchase_roas',
      'date_start',
      'date_stop'
    ].join(',')
  };

  while (nextUrl) {
    const response: { data: any } = await axios.get(nextUrl, { params: nextUrl.includes('?') ? undefined : params });
    const data: any = response.data;
    for (const row of data.data || []) {
      const actions = parseActions(row.actions);
      rows.push(normalizeMetric({
        platform: Platform.META,
        adAccountExternalId: input.adAccountId.replace(/^act_/, ''),
        campaignExternalId: String(row.campaign_id),
        campaignName: row.campaign_name || 'Campanha Meta Ads',
        objective: row.objective || null,
        status: null,
        effectiveStatus: null,
        date: row.date_start,
        spend: Number(row.spend || 0),
        impressions: Number(row.impressions || 0),
        reach: Number(row.reach || 0),
        frequency: Number(row.frequency || 0),
        clicks: Number(row.clicks || 0),
        linkClicks: Number(row.inline_link_clicks || 0),
        ctr: Number(row.ctr || 0),
        cpc: Number(row.cpc || 0),
        cpm: Number(row.cpm || 0),
        conversions: actions.conversions,
        leads: actions.leads,
        messages: actions.messages,
        purchases: actions.purchases,
        purchaseValue: parsePurchaseValue(row),
        rawPayload: row
      }));
    }
    nextUrl = data.paging?.next || null;
  }

  return rows;
}
