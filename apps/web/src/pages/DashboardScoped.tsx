import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Building2,
  CalendarRange,
  Clock3,
  Database,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Search,
  ShoppingCart,
  Target,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { useAuth } from '../store';

type ClientOption = { id: string; name: string; companyName?: string | null; status?: string };
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
type DashboardContext = {
  selectedClientId?: string | null;
  clients: ClientOption[];
  businesses: BusinessOption[];
  accounts: AccountOption[];
  role: string;
  tenantLocked: boolean;
};
type Summary = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  inlineLinkClicks: number;
  leads: number;
  conversations: number;
  purchases: number;
  revenue: number;
  frequency: number;
  cpm: number;
  ctr: number;
  linkCtr: number;
  cpc: number;
  costPerLead: number;
  costPerConversation: number;
  costPerPurchase: number;
  roas: number;
};
type DailyPoint = { date: string; spend: number; leads: number; conversations: number; purchases: number; revenue: number };
type CampaignRow = {
  id: string;
  metaCampaignId: string;
  name: string;
  objective?: string | null;
  status?: string | null;
  effectiveStatus?: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  conversations: number;
  purchases: number;
  revenue: number;
  frequency: number;
  cpc: number;
  ctr: number;
  cpm: number;
  costPerLead: number;
  costPerConversation: number;
  costPerPurchase: number;
  roas: number;
  adSetCount?: number;
  adAccount?: { id: string; name?: string | null; accountId: string; businessName?: string | null; businessId?: string | null };
};
type HistoryStatus = {
  earliestDate?: string | null;
  latestDate?: string | null;
  dailyRows?: number;
  latestJob?: { id: string; type: string; status: string; recordsProcessed: number; startedAt: string; finishedAt?: string | null; errorMessage?: string | null } | null;
};

const emptySummary: Summary = {
  spend: 0, impressions: 0, reach: 0, clicks: 0, inlineLinkClicks: 0,
  leads: 0, conversations: 0, purchases: 0, revenue: 0, frequency: 0,
  cpm: 0, ctr: 0, linkCtr: 0, cpc: 0, costPerLead: 0,
  costPerConversation: 0, costPerPurchase: 0, roas: 0,
};

const n = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: unknown) => n(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = (value: unknown) => Math.round(n(value)).toLocaleString('pt-BR');
const decimal = (value: unknown) => n(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (value: unknown) => `${decimal(value)}%`;
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

function MetricCard({ label, value, helper, icon: Icon }: { label: string; value: string; helper: string; icon: typeof WalletCards }) {
  return (
    <article className="rounded-[10px] border border-[#dfe4e1] bg-white p-4 shadow-[0_1px_2px_rgba(18,35,26,0.035)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
          <p className="mt-2 tabular-nums text-[23px] font-semibold tracking-[-0.03em] text-[#17221c]">{value}</p>
        </div>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-[#dfe7e2] bg-[#f4f7f5] text-[#176846]">
          <Icon size={15} strokeWidth={1.8} />
        </span>
      </div>
      <p className="mt-2.5 text-[11px] leading-4 text-slate-500">{helper}</p>
    </article>
  );
}

export default function DashboardScoped() {
  const user = useAuth((state) => state.user);
  const isAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');
  const [context, setContext] = useState<DashboardContext | null>(null);
  const [clientId, setClientId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [since, setSince] = useState(isoDaysAgo(29));
  const [until, setUntil] = useState(isoToday());
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [history, setHistory] = useState<HistoryStatus | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [historySyncing, setHistorySyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function loadContext() {
    const response = await api.get('/dashboard/context');
    const data = response.data?.data as DashboardContext;
    setContext(data);
    const saved = localStorage.getItem('gestaoAdsClientId') || '';
    const savedAllowed = data.clients.some((client) => client.id === saved);
    const initial = data.selectedClientId || (savedAllowed ? saved : data.clients[0]?.id) || '';
    setClientId(initial);
    if (initial) localStorage.setItem('gestaoAdsClientId', initial);
  }

  function baseParams() {
    return {
      clientId,
      since,
      until,
      ...(businessId ? { businessId } : {}),
      ...(adAccountId ? { adAccountId } : {}),
    };
  }

  function metricParams() {
    return { ...baseParams(), ...(campaignId ? { campaignId } : {}) };
  }

  async function loadData(silent = false) {
    if (!clientId) {
      setSummary(emptySummary);
      setDaily([]);
      setCampaigns([]);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError('');
    try {
      const [summaryResponse, dailyResponse, campaignsResponse] = await Promise.all([
        api.get('/performance/summary', { params: metricParams() }),
        api.get('/performance/daily', { params: metricParams() }),
        api.get('/performance/campaigns', { params: baseParams() }),
      ]);
      setSummary({ ...emptySummary, ...(summaryResponse.data?.data || {}) });
      setDaily(Array.isArray(dailyResponse.data?.data) ? dailyResponse.data.data : []);
      setCampaigns(Array.isArray(campaignsResponse.data?.data) ? campaignsResponse.data.data : []);
      setLastUpdated(new Date());
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível carregar os indicadores desta empresa.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadHistoryStatus() {
    if (!clientId) return;
    try {
      const response = await api.get('/performance/history-status', { params: { clientId } });
      setHistory(response.data?.data || null);
      const status = response.data?.data?.latestJob?.status;
      setHistorySyncing(status === 'running');
    } catch {
      setHistory(null);
    }
  }

  useEffect(() => {
    void loadContext().catch(() => {
      setError('Não foi possível carregar o contexto de empresas e contas deste acesso.');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!context || !clientId) return;
    void Promise.all([loadData(), loadHistoryStatus()]);
    const timer = window.setInterval(() => {
      void loadData(true);
      void loadHistoryStatus();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [context, clientId, businessId, adAccountId, campaignId, since, until]);

  useEffect(() => {
    if (!historySyncing) return;
    const timer = window.setInterval(() => { void loadHistoryStatus(); }, 5000);
    return () => window.clearInterval(timer);
  }, [historySyncing, clientId]);

  const clients = context?.clients ?? [];
  const assignedAccounts = useMemo(
    () => (context?.accounts ?? []).filter((item) => item.clientId === clientId && item.isAssigned && item.isActive),
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
    if (adAccountId && !accounts.some((account) => account.id === adAccountId)) setAdAccountId('');
    if (businessId && !businesses.some((business) => business.id === businessId)) setBusinessId('');
  }, [accounts, businesses, adAccountId, businessId]);

  useEffect(() => {
    if (campaignId && !campaigns.some((campaign) => campaign.metaCampaignId === campaignId)) setCampaignId('');
  }, [campaigns, campaignId]);

  const selectedClient = clients.find((client) => client.id === clientId);
  const selectedCampaign = campaigns.find((campaign) => campaign.metaCampaignId === campaignId);
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'ACTIVE').length;
  const filteredCampaigns = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...campaigns]
      .filter((campaign) => !term || [campaign.name, campaign.adAccount?.name, campaign.adAccount?.businessName].some((value) => String(value || '').toLowerCase().includes(term)))
      .sort((a, b) => n(b.spend) - n(a.spend));
  }, [campaigns, search]);

  async function sync() {
    if (!clientId) return;
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      await api.post('/performance/sync', { clientId, since, until });
      setNotice('Período sincronizado com a Meta Ads.');
      await Promise.all([loadContext(), loadData(true), loadHistoryStatus()]);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'A sincronização não foi concluída. Tente novamente.');
    } finally {
      setSyncing(false);
    }
  }

  async function syncHistory(allCompanies = false) {
    if (!clientId && !allCompanies) return;
    setHistorySyncing(true);
    setError('');
    setNotice('');
    try {
      if (allCompanies) {
        await api.post('/performance/history-sync-all');
        setNotice('Importação histórica de todas as empresas iniciada em segundo plano.');
      } else {
        await api.post('/performance/history-sync', { clientId });
        setNotice('Importação do histórico completo desta empresa iniciada. Você pode continuar usando a plataforma.');
      }
      await loadHistoryStatus();
    } catch (requestError: any) {
      setHistorySyncing(false);
      setError(requestError?.response?.data?.message || 'Não foi possível iniciar a importação histórica.');
    }
  }

  function changeClient(value: string) {
    setClientId(value);
    setBusinessId('');
    setAdAccountId('');
    setCampaignId('');
    if (value) localStorage.setItem('gestaoAdsClientId', value);
  }

  function changeBusiness(value: string) {
    setBusinessId(value);
    setAdAccountId('');
    setCampaignId('');
  }

  function changeAccount(value: string) {
    setAdAccountId(value);
    setCampaignId('');
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
    if (value === 'year') setSince(`${today.slice(0, 4)}-01-01`);
    if (value === 'history' && history?.earliestDate) setSince(String(history.earliestDate).slice(0, 10));
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[11px] border border-[#dfe4e1] bg-white px-5 py-4 md:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#176846]">Visão de desempenho</p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.035em] text-[#142119]">Dashboard de mídia</h1>
            <p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">Analise o consolidado ou escolha uma campanha específica. Todos os números respeitam empresa, BM, conta e período.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-[8px] border border-[#e2e7e3] bg-[#fafbfa] px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-700"><Clock3 size={13} className="text-[#176846]" />{lastUpdated ? lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Aguardando'}</div>
              <p className="mt-0.5 text-[10px] text-slate-400">Atualização automática: 5 min</p>
            </div>
            <button type="button" onClick={() => { void sync(); }} disabled={!clientId || syncing || assignedAccounts.length === 0} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#176846] px-4 text-[12px] font-semibold text-white hover:bg-[#12563a] disabled:opacity-50"><RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Sincronizando...' : 'Sincronizar período'}</button>
          </div>
        </div>
      </section>

      <section className="rounded-[10px] border border-[#dfe4e1] bg-[#fafbfa] p-4">
        <div className="mb-3 flex items-center gap-2"><Building2 size={15} className="text-[#176846]" /><div><h2 className="text-[13px] font-semibold text-[#1c2b22]">Filtros de análise</h2><p className="text-[10px] text-slate-500">Use a mesma lógica do Gerenciador de Anúncios: conta, campanha e período.</p></div></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Empresa<select value={clientId} onChange={(event) => changeClient(event.target.value)} disabled={Boolean(context?.tenantLocked)} className="mt-1.5 h-9 w-full rounded-[7px] border border-[#d7dfda] bg-white px-3 text-[12px] font-medium normal-case tracking-normal text-slate-700 outline-none disabled:bg-[#f2f4f2]">{!clients.length && <option value="">Nenhuma empresa</option>}{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Business Manager<select value={businessId} onChange={(event) => changeBusiness(event.target.value)} className="mt-1.5 h-9 w-full rounded-[7px] border border-[#d7dfda] bg-white px-3 text-[12px] font-medium normal-case tracking-normal text-slate-700 outline-none"><option value="">Todas as BMs</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
          <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Conta de anúncios<select value={adAccountId} onChange={(event) => changeAccount(event.target.value)} className="mt-1.5 h-9 w-full rounded-[7px] border border-[#d7dfda] bg-white px-3 text-[12px] font-medium normal-case tracking-normal text-slate-700 outline-none"><option value="">Todas as contas</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.accountId}</option>)}</select></label>
          <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Campanha<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)} className="mt-1.5 h-9 w-full rounded-[7px] border border-[#d7dfda] bg-white px-3 text-[12px] font-medium normal-case tracking-normal text-slate-700 outline-none"><option value="">Todas as campanhas</option>{campaigns.map((campaign) => <option key={campaign.metaCampaignId} value={campaign.metaCampaignId}>{campaign.name}</option>)}</select></label>
          <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Período<select defaultValue="30" onChange={(event) => applyPreset(event.target.value)} className="mt-1.5 h-9 w-full rounded-[7px] border border-[#d7dfda] bg-white px-3 text-[12px] font-medium normal-case tracking-normal text-slate-700 outline-none"><option value="today">Hoje</option><option value="7">Últimos 7 dias</option><option value="14">Últimos 14 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="month">Este mês</option><option value="year">Este ano</option>{history?.earliestDate && <option value="history">Todo histórico importado</option>}</select></label>
        </div>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-2 lg:w-[430px]">
            <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500"><span className="inline-flex items-center gap-1.5"><CalendarRange size={12} /> Data inicial</span><input type="date" value={since} max={until} onChange={(event) => setSince(event.target.value)} className="mt-1.5 h-9 w-full rounded-[7px] border border-[#d7dfda] bg-white px-3 text-[12px] outline-none" /></label>
            <label className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500"><span className="inline-flex items-center gap-1.5"><CalendarRange size={12} /> Data final</span><input type="date" value={until} min={since} max={isoToday()} onChange={(event) => setUntil(event.target.value)} className="mt-1.5 h-9 w-full rounded-[7px] border border-[#d7dfda] bg-white px-3 text-[12px] outline-none" /></label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <Database size={13} className="text-[#176846]" />
            <span>Histórico no banco: <strong className="text-slate-700">{dateLabel(history?.earliestDate)} a {dateLabel(history?.latestDate)}</strong></span>
            <button type="button" onClick={() => { void syncHistory(false); }} disabled={!clientId || historySyncing || assignedAccounts.length === 0} className="h-8 rounded-[7px] border border-[#cfdad3] bg-white px-3 font-semibold text-[#176846] hover:bg-[#f4f7f5] disabled:opacity-50">{historySyncing ? 'Importando histórico...' : 'Importar histórico completo'}</button>
            {isAdmin && <button type="button" onClick={() => { void syncHistory(true); }} disabled={historySyncing} className="h-8 rounded-[7px] border border-[#d8dedb] bg-white px-3 font-semibold text-slate-600 hover:bg-[#f4f6f4] disabled:opacity-50">Todas as empresas</button>}
          </div>
        </div>
        {selectedClient && <p className="mt-3 border-t border-[#e6ebe8] pt-2.5 text-[10px] text-slate-400">Visualizando <span className="font-semibold text-slate-600">{selectedClient.name}</span>{selectedCampaign ? <> · campanha <span className="font-semibold text-slate-600">{selectedCampaign.name}</span></> : ' · consolidado de campanhas'} · {since.split('-').reverse().join('/')} a {until.split('-').reverse().join('/')}</p>}
      </section>

      {notice && <p className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12px] text-emerald-800">{notice}</p>}
      {error && <p className="rounded-[8px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800" role="alert">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={WalletCards} label="Investimento" value={loading ? '—' : money(summary.spend)} helper={`${integer(summary.reach)} pessoas alcançadas`} />
        <MetricCard icon={Target} label="Leads" value={loading ? '—' : integer(summary.leads)} helper={`CPL ${money(summary.costPerLead)}`} />
        <MetricCard icon={MessageCircle} label="Conversas" value={loading ? '—' : integer(summary.conversations)} helper={`Custo/conversa ${money(summary.costPerConversation)}`} />
        <MetricCard icon={ShoppingCart} label="Compras" value={loading ? '—' : integer(summary.purchases)} helper={`CPA ${money(summary.costPerPurchase)}`} />
        <MetricCard icon={TrendingUp} label="ROAS" value={loading ? '—' : `${decimal(summary.roas)}x`} helper={`Receita ${money(summary.revenue)}`} />
        <MetricCard icon={MousePointerClick} label="CTR" value={loading ? '—' : pct(summary.ctr)} helper={`CPC ${money(summary.cpc)} · ${integer(summary.clicks)} cliques`} />
        <MetricCard icon={Activity} label="Alcance" value={loading ? '—' : integer(summary.reach)} helper={`Frequência ${decimal(summary.frequency)}`} />
        <MetricCard icon={BarChart3} label="Impressões" value={loading ? '—' : integer(summary.impressions)} helper={`CPM ${money(summary.cpm)}`} />
        <MetricCard icon={Megaphone} label="Campanhas ativas" value={loading ? '—' : integer(activeCampaigns)} helper={`${integer(campaigns.length)} campanhas no escopo`} />
        <MetricCard icon={Database} label="Histórico" value={history?.dailyRows ? integer(history.dailyRows) : '—'} helper={`${dateLabel(history?.earliestDate)} até ${dateLabel(history?.latestDate)}`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[10px] border border-[#dfe4e1] bg-white p-4">
          <div className="mb-3"><h2 className="text-[13px] font-semibold text-[#17251c]">Investimento por dia</h2><p className="mt-0.5 text-[10px] text-slate-400">Série do período e campanha selecionados.</p></div>
          <ResponsiveContainer width="100%" height={235}><LineChart data={daily} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}><CartesianGrid stroke="#edf0ee" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5).split('-').reverse().join('/')} tickLine={false} axisLine={false} fontSize={10} stroke="#87948c" /><YAxis tickLine={false} axisLine={false} fontSize={10} stroke="#87948c" /><Tooltip contentStyle={{ border: '1px solid #dde4df', borderRadius: 7, boxShadow: 'none', fontSize: 11 }} /><Line type="monotone" dataKey="spend" name="Investimento" stroke="#176846" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        </div>
        <div className="rounded-[10px] border border-[#dfe4e1] bg-white p-4">
          <div className="mb-3"><h2 className="text-[13px] font-semibold text-[#17251c]">Resultados por dia</h2><p className="mt-0.5 text-[10px] text-slate-400">Leads, conversas e compras no mesmo filtro.</p></div>
          <ResponsiveContainer width="100%" height={235}><BarChart data={daily} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}><CartesianGrid stroke="#edf0ee" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5).split('-').reverse().join('/')} tickLine={false} axisLine={false} fontSize={10} stroke="#87948c" /><YAxis tickLine={false} axisLine={false} fontSize={10} stroke="#87948c" /><Tooltip contentStyle={{ border: '1px solid #dde4df', borderRadius: 7, boxShadow: 'none', fontSize: 11 }} /><Bar dataKey="leads" name="Leads" fill="#176846" radius={[2, 2, 0, 0]} /><Bar dataKey="conversations" name="Conversas" fill="#8ba799" radius={[2, 2, 0, 0]} /><Bar dataKey="purchases" name="Compras" fill="#46574e" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer>
        </div>
      </section>

      <section className="overflow-hidden rounded-[10px] border border-[#dfe4e1] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e8ece9] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-[14px] font-semibold text-[#17251c]">Desempenho por campanha</h2><p className="mt-0.5 text-[10px] text-slate-400">Clique em uma campanha para aplicar o filtro ao resumo e aos gráficos.</p></div>
          <label className="relative w-full md:w-[280px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar campanha, BM ou conta" className="h-9 w-full rounded-[7px] border border-[#d7dfda] bg-[#fafbfa] pl-9 pr-3 text-[11px] outline-none focus:bg-white" /></label>
        </div>
        <div className="overflow-x-auto premium-scrollbar">
          <table className="w-full min-w-[1500px] text-[11px]">
            <thead className="bg-[#fafbfa] text-left text-[9px] font-semibold uppercase tracking-[0.07em] text-slate-400">
              <tr><th className="px-4 py-2.5">Campanha</th><th className="px-3 py-2.5">BM / Conta</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Investimento</th><th className="px-3 py-2.5">Leads</th><th className="px-3 py-2.5">CPL</th><th className="px-3 py-2.5">Conversas</th><th className="px-3 py-2.5">Custo conv.</th><th className="px-3 py-2.5">Compras</th><th className="px-3 py-2.5">CPA</th><th className="px-3 py-2.5">Alcance</th><th className="px-3 py-2.5">Impressões</th><th className="px-3 py-2.5">Freq.</th><th className="px-3 py-2.5">CTR</th><th className="px-3 py-2.5">CPC</th><th className="px-3 py-2.5">CPM</th><th className="px-3 py-2.5">ROAS</th></tr>
            </thead>
            <tbody>
              {filteredCampaigns.map((campaign) => {
                const selected = campaign.metaCampaignId === campaignId;
                return (
                  <tr key={campaign.id} onClick={() => setCampaignId(selected ? '' : campaign.metaCampaignId)} className={`cursor-pointer border-t border-[#eef1ef] transition-colors ${selected ? 'bg-[#eef6f1]' : 'hover:bg-[#fafcfb]'}`}>
                    <td className="max-w-[280px] px-4 py-3"><p className="truncate font-semibold text-[#17251c]">{campaign.name}</p><p className="mt-0.5 text-[9px] text-slate-400">{campaign.objective || 'Objetivo não informado'}</p></td>
                    <td className="max-w-[220px] px-3 py-3 text-slate-500"><p className="truncate">{campaign.adAccount?.businessName || 'BM não identificada'}</p><p className="mt-0.5 truncate text-[9px] text-slate-400">{campaign.adAccount?.name || campaign.adAccount?.accountId || '-'}</p></td>
                    <td className="px-3 py-3"><span className={`inline-flex rounded-[5px] px-2 py-1 text-[9px] font-semibold ${campaign.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{campaign.status || '-'}</span></td>
                    <td className="px-3 py-3 tabular-nums font-semibold">{money(campaign.spend)}</td><td className="px-3 py-3 tabular-nums">{integer(campaign.leads)}</td><td className="px-3 py-3 tabular-nums">{money(campaign.costPerLead)}</td><td className="px-3 py-3 tabular-nums">{integer(campaign.conversations)}</td><td className="px-3 py-3 tabular-nums">{money(campaign.costPerConversation)}</td><td className="px-3 py-3 tabular-nums">{integer(campaign.purchases)}</td><td className="px-3 py-3 tabular-nums">{money(campaign.costPerPurchase)}</td><td className="px-3 py-3 tabular-nums">{integer(campaign.reach)}</td><td className="px-3 py-3 tabular-nums">{integer(campaign.impressions)}</td><td className="px-3 py-3 tabular-nums">{decimal(campaign.frequency)}</td><td className="px-3 py-3 tabular-nums">{pct(campaign.ctr)}</td><td className="px-3 py-3 tabular-nums">{money(campaign.cpc)}</td><td className="px-3 py-3 tabular-nums">{money(campaign.cpm)}</td><td className="px-3 py-3 tabular-nums font-semibold">{decimal(campaign.roas)}x</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {loading && <p className="px-4 py-7 text-[12px] text-slate-500">Carregando campanhas...</p>}
        {!loading && !filteredCampaigns.length && <p className="px-4 py-7 text-[12px] text-slate-500">Nenhuma campanha encontrada neste período e escopo.</p>}
      </section>
    </div>
  );
}
