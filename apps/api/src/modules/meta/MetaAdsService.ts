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
    p = undefined;
  }
  return results;
}

async function getPagedWithFieldFallback(
  url: string,
  accessToken: string,
  fieldOptions: string[],
  limit = '100',
) {
  for (const fields of fieldOptions) {
    try {
      return await getPaged(url, {
        access_token: accessToken,
        fields,
        limit,
      });
    } catch {
      // Algumas contas/versões da Graph API não expõem todos os campos.
    }
  }
  return [];
}

async function postForm<T>(url: string, accessToken: string, values: Record<string, string>): Promise<T> {
  const body = new URLSearchParams();
  body.set('access_token', accessToken);
  for (const [key, value] of Object.entries(values)) body.set(key, value);

  const response = await withRetry(() => axios.post(url, body, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }));
  return response.data as T;
}

export type MetaCampaignObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_APP_PROMOTION'
  | 'OUTCOME_SALES';

export type MetaSpecialAdCategory = 'HOUSING' | 'EMPLOYMENT' | 'CREDIT' | 'ISSUES_ELECTIONS_POLITICS';

export type MetaBusinessRef = {
  businessId: string;
  businessName: string;
};

export type MetaBusinessUser = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
};

export type MetaBusinessAdAccount = {
  accountId: string;
  name?: string;
  currency?: string;
  accountStatus?: number | null;
};

export type MetaBusinessDirectoryItem = {
  businessId: string;
  businessName: string;
  users: MetaBusinessUser[];
  admins: MetaBusinessUser[];
  pendingUsers: MetaBusinessUser[];
  adAccounts: MetaBusinessAdAccount[];
};

function normalizeBusinessUser(value: any): MetaBusinessUser {
  return {
    id: String(value?.id || ''),
    name: value?.name ? String(value.name) : undefined,
    email: value?.email ? String(value.email).trim().toLowerCase() : undefined,
    role: value?.role ? String(value.role).toUpperCase() : undefined,
    status: value?.status ? String(value.status).toUpperCase() : undefined,
  };
}

export class MetaAdsService {
  constructor(private accessToken: string) {}

  adAccounts() {
    return getPaged(`${BASE()}/me/adaccounts`, {
      access_token: this.accessToken,
      fields: 'account_id,name,currency,timezone_name,account_status',
    });
  }

  async businessDirectory(): Promise<MetaBusinessDirectoryItem[]> {
    const businesses = await getPaged(`${BASE()}/me/businesses`, {
      access_token: this.accessToken,
      fields: 'id,name',
      limit: '100',
    });

    const directory: MetaBusinessDirectoryItem[] = [];

    for (const business of businesses) {
      const businessId = String(business?.id || '').trim();
      if (!businessId) continue;
      const businessName = String(business?.name || `BM ${businessId}`);

      const usersRaw = await getPagedWithFieldFallback(
        `${BASE()}/${businessId}/business_users`,
        this.accessToken,
        [
          'id,name,email,role,status',
          'id,name,email,role',
          'id,name,role,status',
          'id,name,role',
          'id,name',
        ],
      );
      const users = usersRaw.map(normalizeBusinessUser).filter((item) => item.id);
      const admins = users.filter((item) => String(item.role || '').toUpperCase() === 'ADMIN');

      const pendingRaw = await getPagedWithFieldFallback(
        `${BASE()}/${businessId}/pending_users`,
        this.accessToken,
        ['id,email,role,status', 'id,email,role', 'id,email', 'id'],
      );
      const pendingUsers = pendingRaw.map(normalizeBusinessUser).filter((item) => item.id);

      const accountMap = new Map<string, MetaBusinessAdAccount>();
      for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
        try {
          const accounts = await getPaged(`${BASE()}/${businessId}/${edge}`, {
            access_token: this.accessToken,
            fields: 'account_id,name,currency,account_status',
            limit: '200',
          });
          for (const account of accounts) {
            const accountId = String(account?.account_id || '').replace(/^act_/, '');
            if (!accountId || accountMap.has(accountId)) continue;
            accountMap.set(accountId, {
              accountId,
              name: account?.name ? String(account.name) : undefined,
              currency: account?.currency ? String(account.currency) : undefined,
              accountStatus: account?.account_status == null ? null : Number(account.account_status),
            });
          }
        } catch {
          // Uma BM pode estar visível ao usuário sem liberar um dos edges de contas.
        }
      }

      directory.push({
        businessId,
        businessName,
        users,
        admins,
        pendingUsers,
        adAccounts: Array.from(accountMap.values()).sort((a, b) => String(a.name || a.accountId).localeCompare(String(b.name || b.accountId))),
      });
    }

    return directory.sort((a, b) => a.businessName.localeCompare(b.businessName));
  }

  async businessAdAccountMap(): Promise<Map<string, MetaBusinessRef>> {
    const result = new Map<string, MetaBusinessRef>();
    let businesses: any[] = [];

    try {
      businesses = await getPaged(`${BASE()}/me/businesses`, {
        access_token: this.accessToken,
        fields: 'id,name',
        limit: '100',
      });
    } catch {
      return result;
    }

    for (const business of businesses) {
      if (!business?.id) continue;
      for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
        try {
          const accounts = await getPaged(`${BASE()}/${business.id}/${edge}`, {
            access_token: this.accessToken,
            fields: 'account_id,name',
            limit: '200',
          });
          for (const account of accounts) {
            const accountId = String(account?.account_id || '').replace(/^act_/, '');
            if (!accountId || result.has(accountId)) continue;
            result.set(accountId, {
              businessId: String(business.id),
              businessName: String(business.name || `BM ${business.id}`),
            });
          }
        } catch {
          // Algumas BMs podem estar visíveis ao usuário sem liberar todos os edges.
        }
      }
    }

    return result;
  }

  campaigns(actId: string) {
    return getPaged(`${BASE()}/${actId}/campaigns`, {
      access_token: this.accessToken,
      fields: 'id,name,objective,status,effective_status,buying_type,daily_budget,lifetime_budget,start_time,stop_time',
      limit: '200',
    });
  }

  createCampaign(actId: string, input: {
    name: string;
    objective: MetaCampaignObjective;
    dailyBudgetCents?: number;
    specialAdCategories?: MetaSpecialAdCategory[];
  }) {
    const values: Record<string, string> = {
      name: input.name,
      objective: input.objective,
      status: 'PAUSED',
      buying_type: 'AUCTION',
      special_ad_categories: JSON.stringify(input.specialAdCategories ?? []),
    };

    if (input.dailyBudgetCents && input.dailyBudgetCents > 0) {
      values.daily_budget = String(Math.round(input.dailyBudgetCents));
    }

    return postForm<{ id: string }>(`${BASE()}/${actId}/campaigns`, this.accessToken, values);
  }

  updateCampaignStatus(campaignId: string, status: 'ACTIVE' | 'PAUSED') {
    return postForm<{ success?: boolean }>(`${BASE()}/${campaignId}`, this.accessToken, { status });
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
