import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clock3, CreditCard, RefreshCw, WalletCards } from 'lucide-react';
import { api } from '../api';
import { useScope } from '../store';

type FinancialAccount = {
  id: string;
  accountId: string;
  name: string;
  businessId?: string | null;
  businessName?: string | null;
  currency: string;
  accountStatus?: number | null;
  balance?: number;
  amountSpent?: number;
  spendCap?: number;
  isPrepayAccount?: boolean;
  fundingSource?: any;
  timezone?: string | null;
  available: boolean;
  error?: string;
  checkedAt?: string;
};

type FinancialOverview = {
  accounts: FinancialAccount[];
  totalsByCurrency: Array<{ currency: string; balance: number; amountSpent: number; spendCap: number; accounts: number }>;
  updatedAt: string;
};

type FinancialActivity = {
  eventType: string;
  label: string;
  translatedEventType?: string | null;
  eventTime?: string | null;
  actorName?: string | null;
  details?: Record<string, unknown> | null;
};

const money = (value: unknown, currency = 'BRL') => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: currency || 'BRL',
  maximumFractionDigits: 2,
}).format(Number(value || 0));

function activityDetail(details?: Record<string, unknown> | null) {
  if (!details) return '';
  const entries = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '').slice(0, 4);
  return entries.map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`).join(' · ');
}

export default function FinancialStatusBar() {
  const scope = useScope();
  const [data, setData] = useState<FinancialOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activityAccountId, setActivityAccountId] = useState('');
  const [activities, setActivities] = useState<FinancialActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [error, setError] = useState('');

  const params = useMemo(() => ({
    clientId: scope.clientId,
    ...(scope.businessId ? { businessId: scope.businessId } : {}),
    ...(scope.adAccountId ? { adAccountId: scope.adAccountId } : {}),
  }), [scope.clientId, scope.businessId, scope.adAccountId]);

  async function load(silent = false) {
    if (!scope.clientId) {
      setData(null);
      return;
    }
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await api.get('/financial/meta-overview', { params });
      const next = response.data?.data || null;
      setData(next);
      const accounts: FinancialAccount[] = Array.isArray(next?.accounts) ? next.accounts : [];
      setActivityAccountId((current) => {
        if (scope.adAccountId && accounts.some((item) => item.id === scope.adAccountId)) return scope.adAccountId;
        if (current && accounts.some((item) => item.id === current)) return current;
        return accounts[0]?.id || '';
      });
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || 'Não foi possível consultar o saldo da Meta agora.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadActivity(accountId = activityAccountId) {
    if (!scope.clientId || !accountId) return;
    setActivityLoading(true);
    try {
      const response = await api.get('/financial/meta-activity', {
        params: {
          clientId: scope.clientId,
          ...(scope.businessId ? { businessId: scope.businessId } : {}),
          adAccountId: accountId,
        },
      });
      setActivities(Array.isArray(response.data?.data?.activities) ? response.data.data.activities : []);
    } catch (requestError: any) {
      setActivities([]);
      setError(requestError?.response?.data?.error?.message || 'Não foi possível consultar o histórico financeiro da conta.');
    } finally {
      setActivityLoading(false);
    }
  }

  useEffect(() => {
    setActivities([]);
    void load();
    if (!scope.clientId) return;
    const timer = window.setInterval(() => { void load(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [params.clientId, params.businessId, params.adAccountId]);

  useEffect(() => {
    if (expanded && activityAccountId) void loadActivity(activityAccountId);
  }, [expanded, activityAccountId]);

  if (!scope.clientId) return null;

  const accounts = data?.accounts || [];
  const available = accounts.filter((item) => item.available);
  const selected = available.find((item) => item.id === (scope.adAccountId || activityAccountId)) || available[0];
  const totals = data?.totalsByCurrency || [];
  const oneCurrency = totals.length === 1 ? totals[0] : null;
  const balanceText = selected
    ? money(selected.balance, selected.currency)
    : oneCurrency
      ? money(oneCurrency.balance, oneCurrency.currency)
      : totals.length > 1
        ? `${totals.length} moedas`
        : 'Indisponível';
  const spentText = selected
    ? money(selected.amountSpent, selected.currency)
    : oneCurrency
      ? money(oneCurrency.amountSpent, oneCurrency.currency)
      : '—';

  return <div className="border-b border-[#e1e6e3] bg-[#fbfcfb] px-3 py-2 sm:px-4 md:px-5">
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-[10px]">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-[6px] bg-emerald-50 text-emerald-700"><WalletCards size={14}/></span>
        <span><small className="block text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-400">Saldo Meta</small><strong className="tabular-nums text-[12px] text-slate-800">{loading ? 'Atualizando...' : balanceText}</strong></span>
      </div>
      <div><small className="block text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-400">Gasto acumulado da conta</small><strong className="tabular-nums text-[11px] text-slate-700">{spentText}</strong></div>
      {selected && <div className="min-w-0"><small className="block text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-400">Conta acompanhada</small><strong className="block max-w-[260px] truncate text-[10px] text-slate-700">{selected.name} · {selected.businessName || 'Meta'}</strong></div>}
      <div className="ml-auto flex items-center gap-1.5">
        {data?.updatedAt && <span className="hidden items-center gap-1 text-[8px] text-slate-400 xl:inline-flex"><Clock3 size={10}/>Consulta ao vivo {new Date(data.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
        <button className="icon-button h-7 w-7" title="Atualizar saldo agora" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={12} className={loading ? 'animate-spin' : ''}/></button>
        <button className="secondary-button h-7 px-2 text-[9px]" onClick={() => setExpanded((value) => !value)}><CreditCard size={11}/>Saldos e recargas {expanded ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}</button>
      </div>
    </div>

    {error && <p className="mt-2 text-[9px] text-amber-700">{error}</p>}

    {expanded && <div className="mt-3 grid gap-3 border-t border-[#e5e9e6] pt-3 xl:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2"><div><strong className="text-[10px] text-slate-700">Contas e saldos atuais</strong><p className="text-[8px] text-slate-400">Valores consultados diretamente na Meta Marketing API.</p></div></div>
        <div className="premium-scrollbar max-h-[220px] overflow-auto rounded-[7px] border border-[#e1e6e3] bg-white">
          {accounts.map((account) => <button key={account.id} onClick={() => setActivityAccountId(account.id)} className={`grid w-full grid-cols-[1fr_auto] gap-3 border-b border-[#edf0ee] px-3 py-2 text-left last:border-0 ${activityAccountId === account.id ? 'bg-[#eff6ff]' : 'hover:bg-[#fafbfa]'}`}>
            <span className="min-w-0"><strong className="block truncate text-[10px] text-slate-700">{account.name}</strong><small className="block truncate text-[8px] text-slate-400">{account.businessName || 'Meta'} · conta {account.accountId}</small>{!account.available && <small className="block text-[8px] text-amber-700">{account.error || 'Saldo indisponível'}</small>}</span>
            <span className="text-right"><strong className="block tabular-nums text-[10px] text-slate-700">{account.available ? money(account.balance, account.currency) : '—'}</strong><small className="block text-[8px] text-slate-400">saldo</small></span>
          </button>)}
          {!accounts.length && <div className="p-3 text-[9px] text-slate-400">Nenhuma conta Meta atribuída a este escopo.</div>}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2"><div><strong className="text-[10px] text-slate-700">Histórico de recargas e cobranças</strong><p className="text-[8px] text-slate-400">Espelho dos eventos financeiros disponíveis em Atividade da conta, últimos 90 dias.</p></div><button className="icon-button h-7 w-7" title="Atualizar histórico" disabled={activityLoading || !activityAccountId} onClick={() => { void loadActivity(); }}><RefreshCw size={12} className={activityLoading ? 'animate-spin' : ''}/></button></div>
        <div className="premium-scrollbar max-h-[220px] overflow-auto rounded-[7px] border border-[#e1e6e3] bg-white">
          {activities.map((item, index) => <div key={`${item.eventType}-${item.eventTime}-${index}`} className="border-b border-[#edf0ee] px-3 py-2 last:border-0"><div className="flex items-start justify-between gap-3"><strong className="text-[9px] text-slate-700">{item.label}</strong><span className="shrink-0 text-[8px] text-slate-400">{item.eventTime ? new Date(item.eventTime).toLocaleString('pt-BR') : '—'}</span></div><p className="mt-1 text-[8px] text-slate-500">{item.actorName || 'Meta / sistema'}{activityDetail(item.details) ? ` · ${activityDetail(item.details)}` : ''}</p></div>)}
          {!activityLoading && !activities.length && <div className="p-3 text-[9px] text-slate-400">Nenhum evento de recarga/cobrança retornado para esta conta no período.</div>}
          {activityLoading && <div className="p-3 text-[9px] text-slate-400">Consultando atividade financeira...</div>}
        </div>
      </div>
    </div>}
  </div>;
}
