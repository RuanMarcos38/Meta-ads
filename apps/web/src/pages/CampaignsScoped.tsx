import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarRange,
  Layers3,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  Plus,
  RefreshCw,
  ShoppingCart,
  Target,
  WalletCards,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../store';

type ClientOption = { id: string; name: string };
type BusinessOption = { id: string; name: string; clientId: string };
type AccountOption = {
  id: string;
  clientId: string;
  accountId: string;
  name?: string | null;
  currency?: string | null;
  businessId?: string | null;
  businessName?: string | null;
  isActive: boolean;
  isAssigned: boolean;
};
type Context = {
  selectedClientId?: string | null;
  clients: ClientOption[];
  businesses: BusinessOption[];
  accounts: AccountOption[];
  tenantLocked: boolean;
};

type PerformanceMetrics = {
  spend?: number;
  impressions?: number;
  reach?: number;
  frequency?: number;
  clicks?: number;
  inlineLinkClicks?: number;
  ctr?: number;
  linkCtr?: number;
  cpc?: number;
  cpm?: number;
  leads?: number;
  conversations?: number;
  purchases?: number;
  revenue?: number;
  costPerLead?: number;
  costPerConversation?: number;
  costPerPurchase?: number;
  roas?: number;
};

type CampaignRow = PerformanceMetrics & Record<string, any> & {
  id: string;
  metaCampaignId: string;
  name: string;
  objective?: string | null;
  status?: string | null;
  effectiveStatus?: string | null;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  adSetCount?: number;
  adAccount?: AccountOption;
};

type AdSetRow = PerformanceMetrics & Record<string, any> & {
  id: string;
  metaAdsetId: string;
  name: string;
  status?: string | null;
  effectiveStatus?: string | null;
  optimizationGoal?: string | null;
  adCount?: number;
  campaign: CampaignRow & { adAccount?: AccountOption };
};

type AdRow = PerformanceMetrics & Record<string, any> & {
  id: string;
  metaAdId: string;
  name: string;
  status?: string | null;
  effectiveStatus?: string | null;
  creativeId?: string | null;
  adSet: AdSetRow & { campaign: CampaignRow & { adAccount?: AccountOption } };
};

type ViewMode = 'campaigns' | 'adsets' | 'ads';
type Summary = Required<PerformanceMetrics>;

const objectives = [
  ['OUTCOME_LEADS', 'Leads'],
  ['OUTCOME_TRAFFIC', 'Tráfego'],
  ['OUTCOME_ENGAGEMENT', 'Engajamento'],
  ['OUTCOME_SALES', 'Vendas'],
  ['OUTCOME_AWARENESS', 'Reconhecimento'],
  ['OUTCOME_APP_PROMOTION', 'Promoção do app'],
] as const;

const specialCategories = [
  ['', 'Nenhuma categoria especial'],
  ['HOUSING', 'Habitação'],
  ['EMPLOYMENT', 'Emprego'],
  ['CREDIT', 'Crédito'],
  ['ISSUES_ELECTIONS_POLITICS', 'Questões sociais, eleições ou política'],
] as const;

const emptySummary: Summary = {
  spend: 0,
  impressions: 0,
  reach: 0,
  frequency: 0,
  clicks: 0,
  inlineLinkClicks: 0,
  ctr: 0,
  linkCtr: 0,
  cpc: 0,
  cpm: 0,
  leads: 0,
  conversations: 0,
  purchases: 0,
  revenue: 0,
  costPerLead: 0,
  costPerConversation: 0,
  costPerPurchase: 0,
  roas: 0,
};

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: unknown) => num(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const number = (value: unknown) => Math.round(num(value)).toLocaleString('pt-BR');
const decimal = (value: unknown) => num(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: unknown) => `${decimal(value)}%`;
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

function Metric({ label, value, helper, icon: Icon }: { label: string; value: string; helper: string; icon: typeof WalletCards }) {
  return (
    <article className="rounded-[11px] border border-[#dfe5e1] bg-white p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
          <p className="mt-2 text-[20px] font-bold tracking-[-0.03em] text-[#17251c] tabular-nums">{value}</p>
        </div>
        <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#edf3ef] text-[#176846]"><Icon size={15} /></span>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-500">{helper}</p>
    </article>
  );
}

export default function CampaignsScoped() {
  const user = useAuth((state) => state.user);
  const canManage = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const [context, setContext] = useState<Context | null>(null);
  const [clientId, setClientId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [since, setSince] = useState(isoDaysAgo(30));
  const [until, setUntil] = useState(isoToday());
  const [view, setView] = useState<ViewMode>('ads');
  const [campaignRows, setCampaignRows] = useState<CampaignRow[]>([]);
  const [adSetRows, setAdSetRows] = useState<AdSetRow[]>([]);
  const [adRows, setAdRows] = useState<AdRow[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('spend_desc');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [changingId, setChangingId] = useState('');
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('OUTCOME_LEADS');
  const [createAccountId, setCreateAccountId] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [specialCategory, setSpecialCategory] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadContext() {
    const response = await api.get('/dashboard/context');
    const data = response.data?.data as Context;
    setContext(data);
    const saved = localStorage.getItem('gestaoAdsClientId') || '';
    const initial = data.selectedClientId || (data.clients.some((client) => client.id === saved) ? saved : data.clients[0]?.id) || '';
    setClientId(initial);
    if (initial) localStorage.setItem('gestaoAdsClientId', initial);
  }

  function scopeParams() {
    return {
      clientId,
      since,
      until,
      ...(businessId ? { businessId } : {}),
      ...(filterAccountId ? { adAccountId: filterAccountId } : {}),
    };
  }

  async function loadPerformance(silent = false) {
    if (!clientId) {
      setCampaignRows([]);
      setAdSetRows([]);
      setAdRows([]);
      setSummary(emptySummary);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError('');
    try {
      const params = scopeParams();
      const endpoint = view === 'campaigns' ? '/performance/campaigns' : view === 'adsets' ? '/performance/adsets' : '/performance/ads';
      const [summaryResponse, rowsResponse] = await Promise.all([
        api.get('/performance/summary', { params }),
        api.get(endpoint, { params }),
      ]);
      setSummary({ ...emptySummary, ...(summaryResponse.data?.data || {}) });
      const data = Array.isArray(rowsResponse.data?.data) ? rowsResponse.data.data : [];
      if (view === 'campaigns') setCampaignRows(data);
      if (view === 'adsets') setAdSetRows(data);
      if (view === 'ads') setAdRows(data);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível carregar as métricas do período selecionado.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadContext().catch(() => {
      setError('Não foi possível carregar as empresas e contas disponíveis.');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!context || !clientId) return;
    void loadPerformance();
  }, [context, clientId, businessId, filterAccountId, since, until, view]);

  const assignedAccounts = useMemo(
    () => (context?.accounts ?? []).filter((item) => item.clientId === clientId && item.isActive && item.isAssigned),
    [context, clientId],
  );

  const businesses = useMemo(() => {
    const assignedBusinessIds = new Set(assignedAccounts.map((item) => item.businessId).filter(Boolean));
    return (context?.businesses ?? []).filter((item) => item.clientId === clientId && assignedBusinessIds.has(item.id));
  }, [context, clientId, assignedAccounts]);

  const accounts = useMemo(
    () => assignedAccounts.filter((item) => !businessId || item.businessId === businessId),
    [assignedAccounts, businessId],
  );

  useEffect(() => {
    if (!accounts.some((account) => account.id === createAccountId)) setCreateAccountId(accounts[0]?.id || '');
    if (filterAccountId && !accounts.some((account) => account.id === filterAccountId)) setFilterAccountId('');
  }, [accounts, createAccountId, filterAccountId]);

  function changeClient(value: string) {
    setClientId(value);
    setBusinessId('');
    setFilterAccountId('');
    setCreateAccountId('');
    if (value) localStorage.setItem('gestaoAdsClientId', value);
  }

  function applyPreset(value: string) {
    const today = isoToday();
    setUntil(today);
    if (value === 'today') setSince(today);
    if (value === '7') setSince(isoDaysAgo(6));
    if (value === '14') setSince(isoDaysAgo(13));
    if (value === '30') setSince(isoDaysAgo(29));
    if (value === '90') setSince(isoDaysAgo(89));
    if (value === 'month') setSince(`${today.slice(0, 8)}01`);
  }

  async function syncPeriod() {
    if (!clientId) return;
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const response = await api.post('/performance/sync', { clientId, since, until });
      const processed = Number(response.data?.data?.processed || 0);
      setNotice(`Sincronização concluída. ${processed.toLocaleString('pt-BR')} registros de métricas processados no período.`);
      await Promise.all([loadContext(), loadPerformance(true)]);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível sincronizar este período com a Meta.');
    } finally {
      setSyncing(false);
    }
  }

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !createAccountId || !name.trim()) return;
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await api.post('/campaigns', {
        adAccountId: createAccountId,
        name: name.trim(),
        objective,
        ...(dailyBudget ? { dailyBudget: Number(dailyBudget.replace(',', '.')) } : {}),
        specialAdCategories: specialCategory ? [specialCategory] : [],
      });
      setName('');
      setDailyBudget('');
      setSpecialCategory('');
      setShowCreate(false);
      setNotice('Campanha criada na Meta em modo pausado. Revise antes de ativar.');
      setView('campaigns');
      await loadPerformance();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'A campanha não foi criada. Verifique a permissão da conta Meta.');
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(campaign: CampaignRow) {
    const nextStatus = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setChangingId(String(campaign.id));
    setError('');
    setNotice('');
    try {
      await api.post(`/campaigns/${campaign.id}/status`, { status: nextStatus });
      setNotice(nextStatus === 'ACTIVE' ? 'Campanha ativada na Meta.' : 'Campanha pausada na Meta.');
      await loadPerformance();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'A Meta não aceitou a alteração desta campanha.');
    } finally {
      setChangingId('');
    }
  }

  const rawRows = view === 'campaigns' ? campaignRows : view === 'adsets' ? adSetRows : adRows;
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = rawRows.filter((row: any) => {
      if (!query) return true;
      const campaign = view === 'campaigns' ? row : view === 'adsets' ? row.campaign : row.adSet?.campaign;
      const adSet = view === 'adsets' ? row : view === 'ads' ? row.adSet : null;
      const account = campaign?.adAccount;
      return [row.name, campaign?.name, adSet?.name, account?.name, account?.businessName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
    return [...filtered].sort((a: any, b: any) => {
      if (sort === 'spend_asc') return num(a.spend) - num(b.spend);
      if (sort === 'leads_desc') return num(b.leads) - num(a.leads);
      if (sort === 'cpl_asc') return (num(a.costPerLead) || Number.MAX_SAFE_INTEGER) - (num(b.costPerLead) || Number.MAX_SAFE_INTEGER);
      if (sort === 'roas_desc') return num(b.roas) - num(a.roas);
      return num(b.spend) - num(a.spend);
    });
  }, [rawRows, search, sort, view]);

  function hierarchy(row: any) {
    const campaign = view === 'campaigns' ? row : view === 'adsets' ? row.campaign : row.adSet?.campaign;
    const adSet = view === 'adsets' ? row : view === 'ads' ? row.adSet : null;
    const account = campaign?.adAccount;
    return { campaign, adSet, account };
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Operação e análise</p>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[#16231b]">Campanhas e Anúncios</h1>
          <p className="mt-1 text-[13px] text-slate-500">Escolha a BM, conta e período para analisar até o anúncio individual antes de tomar decisões.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <button type="button" onClick={() => setShowCreate((value) => !value)} className="inline-flex h-10 items-center gap-2 rounded-[9px] bg-[#176846] px-4 text-sm font-semibold text-white hover:bg-[#12563a]">
              <Plus size={15} /> {showCreate ? 'Fechar' : 'Nova campanha'}
            </button>
          )}
          <button type="button" onClick={() => { void syncPeriod(); }} disabled={syncing || !clientId || !assignedAccounts.length} className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-[#cbd8d0] bg-white px-3.5 text-sm font-semibold text-[#176846] hover:bg-[#f4f8f5] disabled:opacity-50">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Sincronizando...' : 'Sincronizar período'}
          </button>
        </div>
      </div>

      <section className="rounded-[12px] border border-[#dfe5e1] bg-[#fafbfa] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1c2b22]"><Building2 size={16} className="text-[#176846]" /> Escopo das métricas</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Empresa
            <select value={clientId} onChange={(event) => changeClient(event.target.value)} disabled={Boolean(context?.tenantLocked)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none disabled:bg-[#f2f4f2]">
              {(context?.clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Business Manager
            <select value={businessId} onChange={(event) => { setBusinessId(event.target.value); setFilterAccountId(''); }} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none">
              <option value="">Todas as BMs</option>
              {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Conta Meta Ads
            <select value={filterAccountId} onChange={(event) => setFilterAccountId(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none">
              <option value="">Todas as contas vinculadas</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.accountId}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Período rápido
            <select defaultValue="30" onChange={(event) => applyPreset(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none">
              <option value="today">Hoje</option><option value="7">Últimos 7 dias</option><option value="14">Últimos 14 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="month">Este mês</option>
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:max-w-xl">
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500"><span className="inline-flex items-center gap-1.5"><CalendarRange size={13} /> Data inicial</span><input type="date" value={since} max={until} onChange={(event) => setSince(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none" /></label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500"><span className="inline-flex items-center gap-1.5"><CalendarRange size={13} /> Data final</span><input type="date" value={until} min={since} max={isoToday()} onChange={(event) => setUntil(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none" /></label>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={WalletCards} label="Investimento" value={loading ? '—' : money(summary.spend)} helper={`${number(summary.reach)} pessoas alcançadas · ${number(summary.impressions)} impressões`} />
        <Metric icon={MousePointerClick} label="Cliques / CTR" value={loading ? '—' : `${number(summary.clicks)} · ${percent(summary.ctr)}`} helper={`CPC ${money(summary.cpc)} · CPM ${money(summary.cpm)}`} />
        <Metric icon={Target} label="Leads" value={loading ? '—' : number(summary.leads)} helper={`CPL ${money(summary.costPerLead)} · taxa sobre cliques ${percent(summary.clicks ? (summary.leads / summary.clicks) * 100 : 0)}`} />
        <Metric icon={MessageCircle} label="Conversas" value={loading ? '—' : number(summary.conversations)} helper={`Custo por conversa ${money(summary.costPerConversation)}`} />
        <Metric icon={ShoppingCart} label="Compras" value={loading ? '—' : number(summary.purchases)} helper={`CPA ${money(summary.costPerPurchase)}`} />
        <Metric icon={BarChart3} label="Receita / ROAS" value={loading ? '—' : `${money(summary.revenue)} · ${decimal(summary.roas)}x`} helper="Disponível quando a Meta retorna valor de compra." />
        <Metric icon={Megaphone} label="Frequência" value={loading ? '—' : decimal(summary.frequency)} helper={`CTR de link ${percent(summary.linkCtr)} · ${number(summary.inlineLinkClicks)} cliques no link`} />
        <Metric icon={Layers3} label="Itens analisados" value={loading ? '—' : number(visibleRows.length)} helper={view === 'ads' ? 'Anúncios no escopo atual.' : view === 'adsets' ? 'Conjuntos no escopo atual.' : 'Campanhas no escopo atual.'} />
      </section>

      {showCreate && canManage && (
        <form onSubmit={createCampaign} className="rounded-[12px] border border-[#dfe5e1] bg-white p-4.5">
          <div className="mb-4"><h2 className="text-[15px] font-semibold text-[#17251c]">Criar campanha na Meta Ads</h2><p className="mt-1 text-[11px] text-slate-500">A campanha é criada pausada para revisão antes da ativação.</p></div>
          {!accounts.length ? <p className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Nenhuma conta vinculada está disponível para esta empresa/BM.</p> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">Conta de anúncio<select value={createAccountId} onChange={(event) => setCreateAccountId(event.target.value)} required className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none">{accounts.map((account) => <option key={account.id} value={account.id}>{account.businessName ? `${account.businessName} · ` : ''}{account.name || account.accountId}</option>)}</select></label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-1 xl:col-span-2">Nome da campanha<input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={200} required className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] px-3 text-sm outline-none" placeholder="Ex.: Leads WhatsApp Joinville" /></label>
              <label className="text-xs font-semibold text-slate-600">Objetivo<select value={objective} onChange={(event) => setObjective(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none">{objectives.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-xs font-semibold text-slate-600">Orçamento diário<input value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} inputMode="decimal" className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] px-3 text-sm outline-none" placeholder="Opcional" /></label>
              <label className="text-xs font-semibold text-slate-600">Categoria especial<select value={specialCategory} onChange={(event) => setSpecialCategory(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none">{specialCategories.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}</select></label>
              <div className="md:col-span-2 xl:col-span-3 flex justify-end"><button disabled={creating} className="h-10 rounded-[8px] bg-[#176846] px-5 text-sm font-semibold text-white disabled:opacity-50">{creating ? 'Criando...' : 'Criar campanha pausada'}</button></div>
            </div>
          )}
        </form>
      )}

      {notice && <p className="rounded-[9px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="rounded-[9px] border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">{error}</p>}

      <section className="rounded-[12px] border border-[#dfe5e1] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e8ece9] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {([['campaigns', 'Campanhas'], ['adsets', 'Conjuntos'], ['ads', 'Anúncios']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setView(value)} className={`h-9 rounded-[8px] px-3.5 text-sm font-semibold ${view === value ? 'bg-[#176846] text-white' : 'border border-[#d9e0db] bg-white text-slate-600 hover:bg-[#f7f9f7]'}`}>{label}</button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar campanha, conjunto ou anúncio" className="h-9 min-w-[260px] rounded-[8px] border border-[#d9e0db] px-3 text-sm outline-none" />
            <select value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none"><option value="spend_desc">Maior investimento</option><option value="spend_asc">Menor investimento</option><option value="leads_desc">Mais leads</option><option value="cpl_asc">Menor CPL</option><option value="roas_desc">Maior ROAS</option></select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1980px] text-sm">
            <thead className="bg-[#fafbfa] text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400">
              <tr>
                <th className="px-4 py-3">{view === 'ads' ? 'Anúncio' : view === 'adsets' ? 'Conjunto' : 'Campanha'}</th>
                <th className="px-3 py-3">Campanha / Conjunto</th><th className="px-3 py-3">BM / Conta</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Investimento</th><th className="px-3 py-3">Alcance</th><th className="px-3 py-3">Impressões</th><th className="px-3 py-3">Freq.</th><th className="px-3 py-3">Cliques</th><th className="px-3 py-3">CTR</th><th className="px-3 py-3">CPC</th><th className="px-3 py-3">CPM</th><th className="px-3 py-3">Leads</th><th className="px-3 py-3">CPL</th><th className="px-3 py-3">Conversas</th><th className="px-3 py-3">Custo conv.</th><th className="px-3 py-3">Compras</th><th className="px-3 py-3">CPA</th><th className="px-3 py-3">ROAS</th>{view === 'campaigns' && canManage && <th className="px-4 py-3 text-right">Ação</th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row: any) => {
                const { campaign, adSet, account } = hierarchy(row);
                return (
                  <tr key={row.id} className="border-t border-[#eef1ef] text-[12px]">
                    <td className="px-4 py-3.5"><p className="max-w-[300px] truncate font-semibold text-[#1a2820]" title={row.name}>{row.name}</p><p className="mt-0.5 text-[10px] text-slate-400">ID {view === 'ads' ? row.metaAdId : view === 'adsets' ? row.metaAdsetId : row.metaCampaignId}</p></td>
                    <td className="px-3 py-3.5 text-slate-500"><p className="max-w-[260px] truncate">{view === 'campaigns' ? row.objective || '-' : campaign?.name || '-'}</p>{adSet && view === 'ads' && <p className="mt-0.5 max-w-[260px] truncate text-[10px] text-slate-400">{adSet.name}</p>}</td>
                    <td className="px-3 py-3.5 text-slate-500"><p className="max-w-[220px] truncate">{account?.businessName || 'BM não identificada'}</p><p className="mt-0.5 max-w-[220px] truncate text-[10px] text-slate-400">{account?.name || account?.accountId || '-'}</p></td>
                    <td className="px-3 py-3.5"><span className={`inline-flex rounded-[6px] px-2 py-1 text-[10px] font-semibold ${row.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{row.status || row.effectiveStatus || '-'}</span></td>
                    <td className="px-3 py-3.5 tabular-nums font-semibold">{money(row.spend)}</td><td className="px-3 py-3.5 tabular-nums">{number(row.reach)}</td><td className="px-3 py-3.5 tabular-nums">{number(row.impressions)}</td><td className="px-3 py-3.5 tabular-nums">{decimal(row.frequency)}</td><td className="px-3 py-3.5 tabular-nums">{number(row.clicks)}</td><td className="px-3 py-3.5 tabular-nums">{percent(row.ctr)}</td><td className="px-3 py-3.5 tabular-nums">{money(row.cpc)}</td><td className="px-3 py-3.5 tabular-nums">{money(row.cpm)}</td><td className="px-3 py-3.5 tabular-nums font-semibold text-[#176846]">{number(row.leads)}</td><td className="px-3 py-3.5 tabular-nums">{money(row.costPerLead)}</td><td className="px-3 py-3.5 tabular-nums">{number(row.conversations)}</td><td className="px-3 py-3.5 tabular-nums">{money(row.costPerConversation)}</td><td className="px-3 py-3.5 tabular-nums">{number(row.purchases)}</td><td className="px-3 py-3.5 tabular-nums">{money(row.costPerPurchase)}</td><td className="px-3 py-3.5 tabular-nums font-semibold">{decimal(row.roas)}x</td>
                    {view === 'campaigns' && canManage && <td className="px-4 py-3.5 text-right"><button type="button" onClick={() => { void changeStatus(row); }} disabled={changingId === row.id} className="rounded-[7px] border border-[#d5ddd7] px-3 py-1.5 text-xs font-semibold text-[#176846] hover:bg-[#f3f7f4] disabled:opacity-50">{changingId === row.id ? 'Salvando...' : row.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}</button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading && <p className="px-4 py-7 text-sm text-slate-500">Carregando métricas...</p>}
        {!loading && !visibleRows.length && !error && <p className="px-4 py-7 text-sm text-slate-500">Nenhum item encontrado neste escopo e período. Use “Sincronizar período” se os dados ainda não estiverem no banco.</p>}
      </section>
    </div>
  );
}
