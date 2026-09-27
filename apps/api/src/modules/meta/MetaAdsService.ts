import axios from 'axios';
import { env } from '../../config/env.js';

const BASE = () => `https://graph.facebook.com/${env.meta.apiVersion}`;

export function metaErrorCode(error: any): number | null {
  const raw = error?.response?.data?.error?.code ?? error?.response?.data?.error_code ?? null;
  const code = Number(raw);
  return Number.isFinite(code) ? code : null;
}

export function isMetaRateLimitError(error: any): boolean {
  const code = metaErrorCode(error);
  const status = Number(error?.response?.status || 0);
  const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
  return status === 429 || [4, 17, 32, 613].includes(code ?? -1) || message.includes('request limit') || message.includes('rate limit');
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      // Rate limit não deve gerar novas chamadas imediatas: isso piora a quota do app.
      if (isMetaRateLimitError(e)) throw e;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 500 * (i + 1) * (i + 1)));
    }
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
    } catch (error) {
      if (isMetaRateLimitError(error)) throw error;
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

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function splitDateRange(since: string, until: string, maxDays = 180) {
  const start = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [{ since, until }];

  const ranges: Array<{ since: string; until: string }> = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    ranges.push({ since: formatUtcDate(cursor), until: formatUtcDate(chunkEnd) });
    const next = new Date(chunkEnd);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next;
  }
  return ranges;
}

export type MetaCampaignObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_APP_PROMOTION'
  | 'OUTCOME_SALES';

export type MetaSpecialAdCategory = 'HOUSING' | 'EMPLOYMENT' | 'CREDIT' | 'ISSUES_ELECTIONS_POLITICS';
export type MetaInsightLevel = 'campaign' | 'adset' | 'ad';
export type MetaBreakdown = 'age' | 'gender' | 'region' | 'publisher_platform' | 'device_platform' | 'platform_position';

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
    const businessMap = new Map<string, {
      businessId: string;
      businessName: string;
      accounts: Map<string, MetaBusinessAdAccount>;
    }>();

    const ensureBusiness = (businessIdRaw: unknown, businessNameRaw?: unknown) => {
      const businessId = String(businessIdRaw || '').trim();
      if (!businessId) return null;
      const current = businessMap.get(businessId);
      if (current) {
        const candidateName = String(businessNameRaw || '').trim();
        if ((!current.businessName || current.businessName.startsWith('BM ')) && candidateName) {
          current.businessName = candidateName;
        }
        return current;
      }
      const created = {
        businessId,
        businessName: String(businessNameRaw || `BM ${businessId}`),
        accounts: new Map<string, MetaBusinessAdAccount>(),
      };
      businessMap.set(businessId, created);
      return created;
    };

    // Catálogo leve: lista todas as BMs paginando /me/businesses.
    // Evita consultar users/pending/contas BM por BM, que multiplicava as requisições.
    const businesses = await getPaged(`${BASE()}/me/businesses`, {
      access_token: this.accessToken,
      fields: 'id,name',
      limit: '500',
    });
    for (const business of businesses) ensureBusiness(business?.id, business?.name);

    // Uma única listagem paginada de contas acessíveis complementa o catálogo.
    // Quando a Meta informa business/owner_business, associamos a conta à BM sem chamadas N x BM.
    const visibleAccounts = await getPagedWithFieldFallback(
      `${BASE()}/me/adaccounts`,
      this.accessToken,
      [
        'account_id,name,currency,account_status,business{id,name},owner_business{id,name}',
        'account_id,name,currency,account_status,business{id,name}',
        'account_id,name,currency,account_status,owner_business{id,name}',
        'account_id,name,currency,account_status',
      ],
      '500',
    );

    for (const account of visibleAccounts) {
      const accountId = String(account?.account_id || account?.id || '').replace(/^act_/, '').trim();
      if (!accountId) continue;
      const business = account?.business || account?.owner_business;
      const businessId = String(business?.id || '').trim();
      if (!businessId) continue;
      const target = ensureBusiness(businessId, business?.name);
      if (!target) continue;
      target.accounts.set(accountId, {
        accountId,
        name: account?.name ? String(account.name) : undefined,
        currency: account?.currency ? String(account.currency) : undefined,
        accountStatus: account?.account_status == null ? null : Number(account.account_status),
      });
    }

    return Array.from(businessMap.values())
      .map((entry) => ({
        businessId: entry.businessId,
        businessName: entry.businessName,
        users: [],
        admins: [],
        pendingUsers: [],
        adAccounts: Array.from(entry.accounts.values())
          .sort((a, b) => String(a.name || a.accountId).localeCompare(String(b.name || b.accountId), 'pt-BR')),
      }))
      .sort((a, b) => a.businessName.localeCompare(b.businessName, 'pt-BR'));
  }

  async businessAccounts(businessId: string): Promise<MetaBusinessAdAccount[]> {
    const result = new Map<string, MetaBusinessAdAccount>();

    for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
      try {
        const accounts = await getPaged(`${BASE()}/${businessId}/${edge}`, {
          access_token: this.accessToken,
          fields: 'account_id,name,currency,account_status',
          limit: '500',
        });
        for (const account of accounts) {
          const accountId = String(account?.account_id || account?.id || '').replace(/^act_/, '').trim();
          if (!accountId) continue;
          result.set(accountId, {
            accountId,
            name: account?.name ? String(account.name) : undefined,
            currency: account?.currency ? String(account.currency) : undefined,
            accountStatus: account?.account_status == null ? null : Number(account.account_status),
          });
        }
      } catch (error) {
        if (isMetaRateLimitError(error)) throw error;
        // Algumas BMs podem não liberar um dos edges; o outro continua válido.
      }
    }

    return Array.from(result.values())
      .sort((a, b) => String(a.name || a.accountId).localeCompare(String(b.name || b.accountId), 'pt-BR'));
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

  adSets(actId: string) {
    return getPaged(`${BASE()}/${actId}/adsets`, {
      access_token: this.accessToken,
      fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event',
      limit: '500',
    });
  }

  ads(actId: string) {
    return getPaged(`${BASE()}/${actId}/ads`, {
      access_token: this.accessToken,
      fields: 'id,name,campaign_id,adset_id,status,effective_status,creative{id}',
      limit: '500',
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

  async insights(actId: string, since: string, until: string, level: MetaInsightLevel = 'campaign') {
    const hierarchyFields = level === 'ad'
      ? 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name'
      : level === 'adset'
        ? 'campaign_id,campaign_name,adset_id,adset_name'
        : 'campaign_id,campaign_name';

    const fields = `${hierarchyFields},spend,impressions,reach,frequency,cpm,ctr,cpc,clicks,inline_link_clicks,actions,action_values,cost_per_action_type,date_start`;
    const rows: any[] = [];

    for (const range of splitDateRange(since, until, 180)) {
      const chunk = await getPaged(`${BASE()}/${actId}/insights`, {
        access_token: this.accessToken,
        level,
        time_range: JSON.stringify(range),
        time_increment: '1',
        fields,
        limit: '500',
      });
      rows.push(...chunk);
    }
    return rows;
  }

  async breakdownInsights(
    actId: string,
    since: string,
    until: string,
    breakdown: MetaBreakdown,
    level: MetaInsightLevel = 'campaign',
  ) {
    const hierarchyFields = level === 'ad'
      ? 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name'
      : level === 'adset'
        ? 'campaign_id,campaign_name,adset_id,adset_name'
        : 'campaign_id,campaign_name';
    const fields = `${hierarchyFields},spend,impressions,reach,clicks,actions,action_values,date_start`;
    const rows: any[] = [];

    for (const range of splitDateRange(since, until, 90)) {
      const chunk = await getPaged(`${BASE()}/${actId}/insights`, {
        access_token: this.accessToken,
        level,
        breakdowns: breakdown,
        time_range: JSON.stringify(range),
        time_increment: '1',
        fields,
        limit: '500',
      });
      rows.push(...chunk);
    }
    return rows;
  }
}
