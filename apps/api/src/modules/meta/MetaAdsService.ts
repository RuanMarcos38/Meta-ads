import axios from 'axios';
import { env } from '../../config/env.js';

const BASE = () => `https://graph.facebook.com/${env.meta.apiVersion}`;

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 500 * (i + 1) * (i + 1))); }
  }
  throw lastErr;
}

async function getPaged(url: string, params: Record<string, string>) {
  const results: any[] = [];
  let next: string | undefined = url;
  let p: Record<string, string> | undefined = params;
  while (next) {
    const res: any = await withRetry(() => axios.get(next!, { params: p }));
    results.push(...(res.data.data ?? []));
    next = res.data.paging?.next;
    p = undefined; // next já contém query string
  }
  return results;
}

export class MetaAdsService {
  constructor(private accessToken: string) {}

  adAccounts() {
    return getPaged(`${BASE()}/me/adaccounts`, {
      access_token: this.accessToken,
      fields: 'account_id,name,currency,timezone_name,account_status',
    });
  }

  campaigns(actId: string) {
    return getPaged(`${BASE()}/${actId}/campaigns`, {
      access_token: this.accessToken,
      fields: 'id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,start_time,stop_time',
      limit: '200',
    });
  }

  insights(actId: string, since: string, until: string, level = 'campaign') {
    return getPaged(`${BASE()}/${actId}/insights`, {
      access_token: this.accessToken,
      level,
      time_range: JSON.stringify({ since, until }),
      time_increment: '1',
      fields: 'campaign_id,campaign_name,spend,impressions,reach,frequency,cpm,ctr,cpc,clicks,inline_link_clicks,actions,cost_per_action_type,date_start',
      limit: '500',
    });
  }
}
