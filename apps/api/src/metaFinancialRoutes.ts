import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { z } from 'zod';
import { env } from './config/env.js';
import { prisma } from './shared/prisma.js';
import { decrypt } from './shared/crypto.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  clientId: z.string().uuid().optional(),
  businessId: z.string().trim().min(1).max(100).optional(),
  adAccountId: z.string().uuid().optional(),
});
const activityQuerySchema = querySchema.extend({
  adAccountId: z.string().uuid(),
  since: dateText.optional(),
  until: dateText.optional(),
});

const BILLING_EVENT_LABELS: Record<string, string> = {
  funding_event_initiated: 'Recarga iniciada',
  funding_event_successful: 'Recarga concluída',
  add_funding_source: 'Forma de pagamento adicionada',
  remove_funding_source: 'Forma de pagamento removida',
  ad_account_billing_charge: 'Cobrança realizada',
  ad_account_billing_charge_failed: 'Falha na cobrança',
  ad_account_billing_chargeback: 'Estorno de cobrança',
  ad_account_billing_chargeback_reversal: 'Reversão de estorno',
  ad_account_billing_decline: 'Cobrança recusada',
  ad_account_billing_refund: 'Reembolso',
  account_spending_limit_reached: 'Limite de gastos da conta atingido',
  ad_account_remove_spend_limit: 'Limite de gastos removido',
  ad_account_reset_spend_limit: 'Limite de gastos redefinido',
  ad_account_update_spend_limit: 'Limite de gastos atualizado',
  billing_event: 'Atividade de faturamento',
};
const BILLING_EVENTS = new Set(Object.keys(BILLING_EVENT_LABELS));
const ZERO_DECIMAL_CURRENCIES = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

function baseUrl() {
  return `https://graph.facebook.com/${env.meta.apiVersion}`;
}

function minorToMajor(value: unknown, currency: string) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric / (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100);
}

function currencyAmountToMajor(value: any, fallbackCurrency: string): number | null {
  if (value == null) return null;
  if (typeof value === 'number' || typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (typeof value !== 'object') return null;

  const hundredths = Number(value.amount_in_hundredths);
  if (Number.isFinite(hundredths)) return hundredths / 100;

  const amount = Number(value.amount);
  if (Number.isFinite(amount)) return amount;

  const offsetted = Number(value.offsetted_amount);
  if (Number.isFinite(offsetted)) return offsetted;

  return null;
}

export function resolveDisplayedBalance(data: any, currency: string) {
  const isPrepay = Boolean(data?.is_prepay_account) || String(data?.stored_balance_status || '').toLowerCase() === 'prepay';

  if (isPrepay) {
    const totalPrepay = currencyAmountToMajor(data?.total_prepay_balance, currency);
    if (totalPrepay != null) {
      return { value: totalPrepay, label: 'Fundos disponíveis', source: 'total_prepay_balance' };
    }

    const fundedPrepay = currencyAmountToMajor(data?.prepay_account_balance, currency);
    if (fundedPrepay != null) {
      return { value: fundedPrepay, label: 'Fundos disponíveis', source: 'prepay_account_balance' };
    }
  }

  if (isPrepay) {
    return {
      value: null,
      label: 'Fundos disponíveis',
      source: 'unavailable',
    };
  }

  return {
    value: minorToMajor(data?.balance, currency),
    label: 'Saldo a pagar',
    source: 'balance',
  };
}

function parseExtraData(value: unknown) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return { detalhe: String(value) }; }
}

function graphError(error: any) {
  return String(error?.response?.data?.error?.message || error?.message || 'Falha ao consultar os dados financeiros da Meta.');
}

async function getGraph(path: string, token: string, params: Record<string, unknown>) {
  const response = await axios.get(`${baseUrl()}/${path.replace(/^\//, '')}`, {
    params: { ...params, access_token: token },
    timeout: 20_000,
  });
  return response.data;
}

const BASE_FINANCIAL_FIELDS = [
  'id',
  'account_id',
  'name',
  'currency',
  'account_status',
  'amount_spent',
  'balance',
  'spend_cap',
  'is_prepay_account',
  'timezone_name',
].join(',');

function isGraphRateLimit(error: any) {
  const code = Number(error?.response?.data?.error?.code);
  const status = Number(error?.response?.status || 0);
  const message = graphError(error).toLowerCase();
  return status === 429
    || [4, 17, 32, 613, 80004].includes(code)
    || message.includes('request limit')
    || message.includes('rate limit')
    || message.includes('too many calls');
}

type ConfirmedBalanceSnapshot = {
  value: number;
  currency: string;
  label: string;
  source: string;
  confirmedAt: string;
};

type FinancialFetchResult = {
  data: any;
  token: string;
  connectionId: string;
  fetchedAt: string;
  fromCache: boolean;
  rateLimited: boolean;
  balanceSnapshot: ConfirmedBalanceSnapshot | null;
};

const FINANCIAL_CACHE_TTL_MS = 2 * 60 * 1000;
const FINANCIAL_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
const financialCache = new Map<string, FinancialFetchResult>();
const financialInflight = new Map<string, Promise<FinancialFetchResult>>();
const financialRateLimitedUntil = new Map<string, number>();

async function readConfirmedBalanceSnapshot(
  organizationId: string,
  accountDbId: string,
): Promise<ConfirmedBalanceSnapshot | null> {
  const latest = await prisma.auditLog.findFirst({
    where: {
      organizationId,
      action: 'META_FINANCIAL_BALANCE_SNAPSHOT',
      entity: 'MetaAdAccount',
      entityId: accountDbId,
    },
    orderBy: { createdAt: 'desc' },
    select: { metadataJson: true, createdAt: true },
  });
  const metadata = latest?.metadataJson as any;
  const value = Number(metadata?.value);
  if (!Number.isFinite(value)) return null;
  return {
    value,
    currency: String(metadata?.currency || 'BRL').toUpperCase(),
    label: String(metadata?.label || 'Fundos disponíveis'),
    source: String(metadata?.source || 'meta_confirmed_snapshot'),
    confirmedAt: String(metadata?.confirmedAt || latest?.createdAt?.toISOString() || new Date().toISOString()),
  };
}

async function persistConfirmedBalanceSnapshot(
  organizationId: string,
  accountDbId: string,
  snapshot: ConfirmedBalanceSnapshot,
) {
  const previous = await readConfirmedBalanceSnapshot(organizationId, accountDbId);
  const previousTime = previous ? new Date(previous.confirmedAt).getTime() : 0;
  const unchanged = previous
    && previous.value === snapshot.value
    && previous.currency === snapshot.currency
    && previous.source === snapshot.source;
  if (unchanged && Date.now() - previousTime < 10 * 60 * 1000) return;

  await prisma.auditLog.create({
    data: {
      organizationId,
      action: 'META_FINANCIAL_BALANCE_SNAPSHOT',
      entity: 'MetaAdAccount',
      entityId: accountDbId,
      metadataJson: snapshot,
    },
  });
}

async function getFinancialAccountGraph(path: string, token: string) {
  const base = await getGraph(path, token, { fields: BASE_FINANCIAL_FIELDS });
  let merged = base;
  let rateLimited = false;

  if (!Boolean(base?.is_prepay_account)) {
    return { data: merged, rateLimited };
  }

  const optionalFieldSets = [
    'total_prepay_balance,prepay_account_balance',
    'total_prepay_balance.fields(amount_in_hundredths,amount,currency),prepay_account_balance.fields(amount_in_hundredths,amount,currency)',
  ];

  for (const fields of optionalFieldSets) {
    try {
      const extra = await getGraph(path, token, { fields });
      merged = { ...merged, ...extra };
      const liveCurrency = String(merged?.currency || 'BRL').toUpperCase();
      if (resolveDisplayedBalance(merged, liveCurrency).value != null) break;
    } catch (error: any) {
      if (isGraphRateLimit(error)) {
        rateLimited = true;
        break;
      }
    }
  }

  return { data: merged, rateLimited };
}

type FinancialConnectionCandidate = {
  id: string;
  status: string;
  accessTokenEncrypted: string;
};

async function getFinancialAccountWithFallback(
  path: string,
  currencyHint: string,
  primaryConnection: FinancialConnectionCandidate,
  organizationId: string,
  clientId: string,
  accountDbId: string,
): Promise<FinancialFetchResult> {
  const cacheKey = `${organizationId}:${path}`;
  const now = Date.now();
  const cached = financialCache.get(cacheKey);

  if (cached && now - new Date(cached.fetchedAt).getTime() < FINANCIAL_CACHE_TTL_MS) {
    return { ...cached, fromCache: true };
  }

  const inflight = financialInflight.get(cacheKey);
  if (inflight) return inflight;

  const blockedUntil = financialRateLimitedUntil.get(cacheKey) || 0;
  if (blockedUntil > now && cached) {
    return { ...cached, fromCache: true, rateLimited: true };
  }

  const task = (async (): Promise<FinancialFetchResult> => {
    const alternatives = await prisma.metaConnection.findMany({
      where: {
        organizationId,
        status: 'active',
        OR: [{ clientId }, { clientId: null }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 2,
      select: {
        id: true,
        status: true,
        accessTokenEncrypted: true,
      },
    });

    const candidates = [primaryConnection, ...alternatives]
      .filter((connection, index, all) =>
        connection.status === 'active'
        && all.findIndex((item) => item.id === connection.id) === index)
      .slice(0, 2);

    let firstSuccessful: FinancialFetchResult | null = null;
    let lastError: any = null;

    for (const connection of candidates) {
      try {
        const token = decrypt(connection.accessTokenEncrypted);
        const graph = await getFinancialAccountGraph(path, token);
        const data = graph.data;
        const currency = String(data?.currency || currencyHint || 'BRL').toUpperCase();
        const liveDisplayedBalance = resolveDisplayedBalance(data, currency);
      const displayedBalance = liveDisplayedBalance.value != null
        ? liveDisplayedBalance
        : financial.balanceSnapshot
          ? {
              value: financial.balanceSnapshot.value,
              label: financial.balanceSnapshot.label,
              source: 'last_confirmed_meta_balance',
            }
          : liveDisplayedBalance;

        const liveSnapshot: ConfirmedBalanceSnapshot | null = displayedBalance.value == null
          ? null
          : {
              value: displayedBalance.value,
              currency,
              label: displayedBalance.label,
              source: displayedBalance.source,
              confirmedAt: new Date().toISOString(),
            };

        if (graph.rateLimited) {
          financialRateLimitedUntil.set(cacheKey, Date.now() + FINANCIAL_RATE_LIMIT_BACKOFF_MS);
        }

        const persistedSnapshot = liveSnapshot
          || await readConfirmedBalanceSnapshot(organizationId, accountDbId);

        if (liveSnapshot) {
          await persistConfirmedBalanceSnapshot(organizationId, accountDbId, liveSnapshot);
        }

        const result: FinancialFetchResult = {
          data,
          token,
          connectionId: connection.id,
          fetchedAt: new Date().toISOString(),
          fromCache: false,
          rateLimited: graph.rateLimited,
          balanceSnapshot: persistedSnapshot,
        };

        financialCache.set(cacheKey, result);
        if (!firstSuccessful) firstSuccessful = result;

        const isPrepay = Boolean(data?.is_prepay_account);
        if (!isPrepay || liveSnapshot) return result;

        // Resposta base real já recebida. Não insistimos com várias chamadas/tokens
        // no mesmo ciclo porque isso pode bloquear a leitura financeira da conta.
        return result;
      } catch (error: any) {
        lastError = error;
        if (isGraphRateLimit(error)) {
          financialRateLimitedUntil.set(cacheKey, Date.now() + FINANCIAL_RATE_LIMIT_BACKOFF_MS);
          if (cached) return { ...cached, fromCache: true, rateLimited: true };
          break;
        }
      }
    }

    if (firstSuccessful) return firstSuccessful;
    if (cached) return { ...cached, fromCache: true, rateLimited: isGraphRateLimit(lastError) };
    throw lastError || new Error('Nenhuma conexão Meta ativa conseguiu consultar a conta de anúncios.');
  })();

  financialInflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    financialInflight.delete(cacheKey);
  }
}

async function getPagedGraph(path: string, token: string, params: Record<string, unknown>) {
  const rows: any[] = [];
  let next: string | null = `${baseUrl()}/${path.replace(/^\//, '')}`;
  let requestParams: Record<string, unknown> | undefined = { ...params, access_token: token };
  let pages = 0;
  while (next && pages < 10) {
    const response: any = await axios.get(next, { params: requestParams, timeout: 20_000 });
    rows.push(...(response.data?.data || []));
    next = response.data?.paging?.next || null;
    requestParams = undefined;
    pages += 1;
  }
  return rows;
}

function fundingSourceSummary(value: any) {
  if (!value || typeof value !== 'object') return null;
  return {
    type: value.type ?? value.funding_source_type ?? null,
    displayString: value.display_string ?? value.displayString ?? value.description ?? null,
    lastFourDigits: value.last_four_digits ?? value.last4 ?? null,
    expiration: value.expiration ?? value.expiry ?? null,
  };
}

async function resolveClient(user: AuthUser, requestedClientId: string | undefined, reply: any) {
  const clientId = scopeClient(user, requestedClientId);
  if (!clientId) {
    reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa para consultar os saldos.'));
    return null;
  }
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: user.organizationId! },
    select: { id: true, name: true },
  });
  if (!client) {
    reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para este acesso.'));
    return null;
  }
  return client;
}

export async function registerMetaFinancialRoutes(app: FastifyInstance) {
  app.get('/financial/meta-overview', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = querySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Escopo financeiro inválido.'));
    const client = await resolveClient(user, query.data.clientId, reply);
    if (!client) return;

    const accounts = await prisma.metaAdAccount.findMany({
      where: {
        organizationId: user.organizationId!,
        clientId: client.id,
        isActive: true,
        isAssigned: true,
        ...(query.data.businessId ? { businessId: query.data.businessId } : {}),
        ...(query.data.adAccountId ? { id: query.data.adAccountId } : {}),
      },
      include: { connection: true },
      orderBy: [{ businessName: 'asc' }, { name: 'asc' }],
      take: 50,
    });

    if (query.data.adAccountId && !accounts.length) {
      return reply.code(404).send(fail('META_ACCOUNT_NOT_ASSIGNED', 'A conta Meta selecionada não pertence ao escopo atual.'));
    }

    const rows = await Promise.all(accounts.map(async (account) => {
      const currency = String(account.currency || 'BRL').toUpperCase();

      try {
        const actId = String(account.accountId).startsWith('act_') ? String(account.accountId) : `act_${account.accountId}`;
        const financial = await getFinancialAccountWithFallback(
          actId,
          currency,
          account.connection,
          user.organizationId!,
          client.id,
          account.id,
        );
        const data = financial.data;
        const liveCurrency = String(data?.currency || currency).toUpperCase();
        const liveDisplayedBalance = resolveDisplayedBalance(data, liveCurrency);
        const displayedBalance = liveDisplayedBalance.value != null
          ? liveDisplayedBalance
          : financial.balanceSnapshot
            ? {
                value: financial.balanceSnapshot.value,
                label: financial.balanceSnapshot.label,
                source: 'last_confirmed_meta_balance',
              }
            : liveDisplayedBalance;
        return {
          id: account.id,
          accountId: String(data?.account_id || account.accountId).replace(/^act_/, ''),
          name: String(data?.name || account.name || `Conta ${account.accountId}`),
          businessId: account.businessId,
          businessName: account.businessName,
          currency: liveCurrency,
          accountStatus: data?.account_status == null ? account.accountStatus : Number(data.account_status),
          balance: displayedBalance.value,
          balanceLabel: displayedBalance.label,
          balanceSource: displayedBalance.source,
          balanceConfirmedAt: financial.balanceSnapshot?.confirmedAt || financial.fetchedAt,
          balanceFromCache: financial.fromCache || displayedBalance.source === 'last_confirmed_meta_balance',
          rateLimited: financial.rateLimited,
          amountDue: minorToMajor(data?.balance, liveCurrency),
          amountSpent: minorToMajor(data?.amount_spent, liveCurrency),
          spendCap: minorToMajor(data?.spend_cap, liveCurrency),
          isPrepayAccount: Boolean(data?.is_prepay_account),
          fundingSource: data?.funding_source_details || null,
          timezone: data?.timezone_name || account.timezone || null,
          available: true,
          checkedAt: new Date().toISOString(),
        };
      } catch (error: any) {
        return {
          id: account.id,
          accountId: account.accountId,
          name: account.name || `Conta ${account.accountId}`,
          businessId: account.businessId,
          businessName: account.businessName,
          currency,
          available: false,
          error: graphError(error),
        };
      }
    }));

    const totalsByCurrency = new Map<string, { currency: string; balance: number; amountSpent: number; spendCap: number; accounts: number }>();
    rows.filter((row: any) => row.available).forEach((row: any) => {
      const current = totalsByCurrency.get(row.currency) || { currency: row.currency, balance: 0, amountSpent: 0, spendCap: 0, accounts: 0 };
      current.balance += Number(row.balance || 0);
      current.amountSpent += Number(row.amountSpent || 0);
      current.spendCap += Number(row.spendCap || 0);
      current.accounts += 1;
      totalsByCurrency.set(row.currency, current);
    });

    return ok({
      client,
      scope: { businessId: query.data.businessId || null, adAccountId: query.data.adAccountId || null },
      accounts: rows,
      totalsByCurrency: Array.from(totalsByCurrency.values()),
      source: 'Meta Marketing API',
      updatedAt: new Date().toISOString(),
      refreshRecommendedSeconds: 300,
    });
  });

  app.get('/financial/meta-payment-center', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = activityQuerySchema.pick({ clientId: true, businessId: true, adAccountId: true }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Conta de anúncios inválida para cobrança.'));
    const client = await resolveClient(user, query.data.clientId, reply);
    if (!client) return;

    const account = await prisma.metaAdAccount.findFirst({
      where: {
        id: query.data.adAccountId,
        organizationId: user.organizationId!,
        clientId: client.id,
        isActive: true,
        isAssigned: true,
        ...(query.data.businessId ? { businessId: query.data.businessId } : {}),
      },
      include: { connection: true },
    });
    if (!account) return reply.code(404).send(fail('META_ACCOUNT_NOT_ASSIGNED', 'A conta Meta selecionada não pertence ao perfil deste usuário.'));

    try {
      const actId = String(account.accountId).startsWith('act_') ? String(account.accountId) : `act_${account.accountId}`;
      const financial = await getFinancialAccountWithFallback(
        actId,
        String(account.currency || 'BRL').toUpperCase(),
        account.connection,
        user.organizationId!,
        client.id,
        account.id,
      );
      const token = financial.token;
      const data = financial.data;
      const currency = String(data?.currency || account.currency || 'BRL').toUpperCase();
      const displayedBalance = resolveDisplayedBalance(data, currency);
      const rawAccountId = String(data?.account_id || account.accountId).replace(/^act_/, '');
      const businessId = account.businessId || query.data.businessId || null;

      let businessCreditCards: any[] = [];
      let extendedCredits: any[] = [];
      let creditCardsReadable = false;
      let extendedCreditsReadable = false;
      const capabilityErrors: string[] = [];
      if (businessId) {
        try {
          businessCreditCards = await getPagedGraph(`${businessId}/creditcards`, token, {
            fields: 'id,name,status,display_string,expiration',
            limit: '100',
          });
          creditCardsReadable = true;
        } catch (error: any) {
          capabilityErrors.push(`creditcards: ${graphError(error)}`);
        }
        try {
          extendedCredits = await getPagedGraph(`${businessId}/extendedcredits`, token, {
            fields: 'id,legal_entity_name,max_balance,online_max_balance,is_owned_credit_line,owner_business,name',
            limit: '100',
          });
          extendedCreditsReadable = true;
        } catch (error: any) {
          capabilityErrors.push(`extendedcredits: ${graphError(error)}`);
        }
      }

      if (capabilityErrors.length) {
        req.log.warn({ accountId: rawAccountId, businessId, capabilityErrors }, 'Alguns recursos financeiros da Meta não ficaram disponíveis nesta consulta.');
      }

      return ok({
        client: { id: client.id, name: client.name },
        account: {
          id: account.id,
          accountId: rawAccountId,
          name: String(data?.name || account.name || `Conta ${rawAccountId}`),
          businessId,
          businessName: account.businessName,
          currency,
          accountStatus: data?.account_status == null ? account.accountStatus : Number(data.account_status),
          balance: displayedBalance.value,
          balanceLabel: displayedBalance.label,
          balanceSource: displayedBalance.source,
          balanceConfirmedAt: financial.balanceSnapshot?.confirmedAt || financial.fetchedAt,
          balanceFromCache: financial.fromCache || displayedBalance.source === 'last_confirmed_meta_balance',
          rateLimited: financial.rateLimited,
          amountDue: minorToMajor(data?.balance, currency),
          amountSpent: minorToMajor(data?.amount_spent, currency),
          spendCap: minorToMajor(data?.spend_cap, currency),
          isPrepayAccount: Boolean(data?.is_prepay_account),
          fundingSource: fundingSourceSummary(data?.funding_source_details),
          timezone: data?.timezone_name || account.timezone || null,
        },
        paymentProfile: {
          businessId,
          currentFundingSource: fundingSourceSummary(data?.funding_source_details),
          businessCreditCards: businessCreditCards.map((item: any) => ({
            id: item?.id || null,
            name: item?.name || item?.display_string || 'Forma de pagamento',
            status: item?.status || null,
            displayString: item?.display_string || null,
            expiration: item?.expiration || null,
          })),
          extendedCredits: extendedCredits.map((item: any) => ({
            id: item?.id || null,
            name: item?.name || item?.legal_entity_name || 'Linha de crédito',
            legalEntityName: item?.legal_entity_name || null,
            maxBalance: item?.max_balance || null,
            onlineMaxBalance: item?.online_max_balance || null,
            owned: Boolean(item?.is_owned_credit_line),
          })),
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return reply.code(502).send(fail('META_PAYMENT_CENTER_ERROR', 'Não foi possível consultar os dados de cobrança desta conta Meta.', { detail: process.env.NODE_ENV === 'production' ? undefined : graphError(error) }));
    }
  });

  app.get('/financial/meta-activity', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = activityQuerySchema.safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Conta ou período de atividade inválido.'));
    const client = await resolveClient(user, query.data.clientId, reply);
    if (!client) return;

    const account = await prisma.metaAdAccount.findFirst({
      where: {
        id: query.data.adAccountId,
        organizationId: user.organizationId!,
        clientId: client.id,
        isActive: true,
        isAssigned: true,
        ...(query.data.businessId ? { businessId: query.data.businessId } : {}),
      },
      include: { connection: true },
    });
    if (!account) return reply.code(404).send(fail('META_ACCOUNT_NOT_ASSIGNED', 'A conta Meta selecionada não pertence ao escopo atual.'));
    if (account.connection.status !== 'active') return reply.code(409).send(fail('META_CONNECTION_REQUIRED', 'A conexão Meta desta conta está inativa.'));

    const until = query.data.until || new Date().toISOString().slice(0, 10);
    const defaultSince = new Date();
    defaultSince.setDate(defaultSince.getDate() - 90);
    const since = query.data.since || defaultSince.toISOString().slice(0, 10);
    if (since > until) return reply.code(400).send(fail('VALIDATION', 'A data inicial precisa ser anterior à data final.'));

    try {
      const token = decrypt(account.connection.accessTokenEncrypted);
      const actId = String(account.accountId).startsWith('act_') ? String(account.accountId) : `act_${account.accountId}`;
      const rows = await getPagedGraph(`${actId}/activities`, token, {
        fields: 'actor_id,actor_name,application_name,date_time_in_timezone,event_time,event_type,extra_data,object_id,object_name,object_type,tool,translated_event_type',
        category: 'ACCOUNT',
        since: `${since}T00:00:00`,
        until: `${until}T23:59:59`,
        limit: '500',
      });

      const billingRows = rows
        .filter((row: any) => BILLING_EVENTS.has(String(row?.event_type || '')))
        .map((row: any) => ({
          eventType: String(row?.event_type || ''),
          label: BILLING_EVENT_LABELS[String(row?.event_type || '')] || String(row?.translated_event_type || 'Atividade financeira'),
          translatedEventType: row?.translated_event_type || null,
          eventTime: row?.date_time_in_timezone || row?.event_time || null,
          actorName: row?.actor_name || 'Meta / sistema',
          applicationName: row?.application_name || null,
          objectName: row?.object_name || account.name || null,
          objectType: row?.object_type || null,
          tool: row?.tool || null,
          details: parseExtraData(row?.extra_data),
        }))
        .sort((a: any, b: any) => String(b.eventTime || '').localeCompare(String(a.eventTime || '')));

      return ok({
        account: { id: account.id, accountId: account.accountId, name: account.name, currency: account.currency, businessName: account.businessName },
        period: { since, until },
        activities: billingRows,
        source: 'Meta Marketing API · Atividade da conta',
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      return reply.code(502).send(fail('META_FINANCIAL_ACTIVITY_ERROR', 'Não foi possível consultar a atividade financeira da conta Meta.', { detail: process.env.NODE_ENV === 'production' ? undefined : graphError(error) }));
    }
  });
}
