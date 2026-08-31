export type StatusSeverity = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export type LiveAccountFinancialState = {
  accountStatusCode: number | null;
  accountStatusLabel: string;
  financialStatusKey: string;
  financialStatusLabel: string;
  severity: StatusSeverity;
  paymentIssue: boolean;
  disableReasonCode: number | null;
  isPrepayAccount: boolean | null;
  balance: number | null;
  balanceKind: 'prepaid_available' | 'meta_balance' | 'unavailable';
  balanceLabel: string;
  amountSpent: number | null;
  spendCap: number | null;
  remainingSpendLimit: number | null;
  fundingSourceLabel: string | null;
  failedDeliveryChecks: Array<{ code?: string | number | null; message?: string | null; summary?: string | null }>;
};

const ACCOUNT_STATUS: Record<number, { label: string; key: string; severity: StatusSeverity }> = {
  1: { label: 'Ativa', key: 'OK', severity: 'success' },
  2: { label: 'Desativada', key: 'ACCOUNT_DISABLED', severity: 'danger' },
  3: { label: 'Pagamento pendente', key: 'PAYMENT_ERROR', severity: 'danger' },
  7: { label: 'Em análise de risco', key: 'ACCOUNT_REVIEW', severity: 'warning' },
  8: { label: 'Pagamento em processamento', key: 'PAYMENT_PROCESSING', severity: 'info' },
  9: { label: 'Período de carência', key: 'GRACE_PERIOD', severity: 'warning' },
  100: { label: 'Encerramento pendente', key: 'ACCOUNT_CLOSING', severity: 'warning' },
  101: { label: 'Encerrada', key: 'ACCOUNT_CLOSED', severity: 'neutral' },
};

const CAMPAIGN_STATUS: Record<string, { label: string; severity: StatusSeverity }> = {
  ACTIVE: { label: 'Ativa', severity: 'success' },
  PAUSED: { label: 'Pausada', severity: 'neutral' },
  ARCHIVED: { label: 'Arquivada', severity: 'neutral' },
  DELETED: { label: 'Excluída', severity: 'neutral' },
  IN_PROCESS: { label: 'Processando', severity: 'info' },
  WITH_ISSUES: { label: 'Com problemas', severity: 'danger' },
  PENDING_REVIEW: { label: 'Em análise', severity: 'warning' },
  DISAPPROVED: { label: 'Reprovada', severity: 'danger' },
  PREAPPROVED: { label: 'Pré-aprovada', severity: 'info' },
  PENDING_BILLING_INFO: { label: 'Aguardando cobrança', severity: 'warning' },
  CAMPAIGN_PAUSED: { label: 'Campanha pausada', severity: 'neutral' },
  ADSET_PAUSED: { label: 'Conjunto pausado', severity: 'neutral' },
};

function currencyDivisor(currency?: string | null) {
  if (!currency) return 100;
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    return 10 ** digits;
  } catch {
    return 100;
  }
}

function minorAmount(value: unknown, currency?: string | null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed / currencyDivisor(currency);
}

function normalizeFailedChecks(value: unknown): LiveAccountFinancialState['failedDeliveryChecks'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item: any) => ({
    code: item?.code ?? item?.error_code ?? null,
    message: item?.message ? String(item.message) : item?.error_message ? String(item.error_message) : null,
    summary: item?.summary ? String(item.summary) : item?.error_summary ? String(item.error_summary) : null,
  }));
}

function hasPaymentFailure(checks: LiveAccountFinancialState['failedDeliveryChecks']) {
  return checks.some((item) => /payment|billing|funding|card|pagamento|cobran/i.test(`${item.message || ''} ${item.summary || ''}`));
}

function fundingLabel(value: any) {
  if (!value || typeof value !== 'object') return null;
  const candidate = value.display_string || value.displayString || value.type || value.funding_source_type;
  return candidate ? String(candidate) : null;
}

export function resolveAccountFinancialState(raw: any): LiveAccountFinancialState {
  const currency = raw?.currency ? String(raw.currency) : null;
  const accountStatusCode = raw?.account_status == null ? null : Number(raw.account_status);
  const disableReasonCode = raw?.disable_reason == null ? null : Number(raw.disable_reason);
  const isPrepayAccount = raw?.is_prepay_account == null ? null : Boolean(raw.is_prepay_account);
  const balance = minorAmount(raw?.balance, currency);
  const amountSpent = minorAmount(raw?.amount_spent, currency);
  const spendCap = minorAmount(raw?.spend_cap, currency);
  const failedDeliveryChecks = normalizeFailedChecks(raw?.failed_delivery_checks);
  const paymentFailure = accountStatusCode === 3 || hasPaymentFailure(failedDeliveryChecks);

  let mapped = accountStatusCode != null ? ACCOUNT_STATUS[accountStatusCode] : undefined;
  if (!mapped) mapped = { label: accountStatusCode == null ? 'Status não informado' : `Status Meta ${accountStatusCode}`, key: 'UNKNOWN', severity: 'neutral' };

  let financialStatusKey = mapped.key;
  let financialStatusLabel = mapped.label;
  let severity = mapped.severity;

  if (paymentFailure) {
    financialStatusKey = 'PAYMENT_ERROR';
    financialStatusLabel = 'Erro de pagamento';
    severity = 'danger';
  } else if (isPrepayAccount === true && balance !== null && balance <= 0) {
    financialStatusKey = 'NO_BALANCE';
    financialStatusLabel = 'Sem saldo';
    severity = 'danger';
  }

  const remainingSpendLimit = spendCap !== null && spendCap > 0 && amountSpent !== null
    ? Math.max(spendCap - amountSpent, 0)
    : null;

  return {
    accountStatusCode,
    accountStatusLabel: mapped.label,
    financialStatusKey,
    financialStatusLabel,
    severity,
    paymentIssue: financialStatusKey === 'PAYMENT_ERROR',
    disableReasonCode,
    isPrepayAccount,
    balance,
    balanceKind: balance === null ? 'unavailable' : isPrepayAccount ? 'prepaid_available' : 'meta_balance',
    balanceLabel: balance === null ? 'Saldo não disponibilizado pela Meta' : isPrepayAccount ? 'Saldo pré-pago disponível' : 'Saldo retornado pela Meta',
    amountSpent,
    spendCap,
    remainingSpendLimit,
    fundingSourceLabel: fundingLabel(raw?.funding_source_details),
    failedDeliveryChecks,
  };
}

function issueSummary(issues: unknown) {
  if (!Array.isArray(issues)) return null;
  for (const issue of issues) {
    const text = issue?.error_summary || issue?.error_message || issue?.message;
    if (text) return String(text);
  }
  return null;
}

export function resolveCampaignDeliveryState(raw: any, account?: LiveAccountFinancialState | null) {
  if (account && ['PAYMENT_ERROR', 'NO_BALANCE', 'ACCOUNT_REVIEW', 'PAYMENT_PROCESSING', 'GRACE_PERIOD', 'ACCOUNT_DISABLED', 'ACCOUNT_CLOSING', 'ACCOUNT_CLOSED'].includes(account.financialStatusKey)) {
    return {
      deliveryStatusKey: account.financialStatusKey,
      deliveryStatusLabel: account.financialStatusLabel,
      severity: account.severity,
      reason: account.financialStatusLabel,
    };
  }

  const effective = String(raw?.effective_status || raw?.configured_status || raw?.status || '').toUpperCase();
  const mapped = CAMPAIGN_STATUS[effective] || { label: effective || 'Status não informado', severity: 'neutral' as StatusSeverity };
  const issue = issueSummary(raw?.issues_info);
  return {
    deliveryStatusKey: effective || 'UNKNOWN',
    deliveryStatusLabel: mapped.label,
    severity: mapped.severity,
    reason: issue,
  };
}
