import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Building2,
  CalendarRange,
  Clock3,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
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
type DailyPoint = {
  date: string;
  spend: number;
  leads: number;
  conversations: number;
  purchases: number;
  revenue: number;
};
type CampaignRow = {
  id: string;
  metaCampaignId: string;
  name: string;
  objective?: string | null;
  status?: string | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  conversations: number;
  purchases: number;
  revenue: number;
  cpc: number;
  ctr: number;
  cpm: number;
  costPerLead: number;
  costPerConversation: number;
  costPerPurchase: number;
  roas: number;
  adAccount?: { name?: string | null; accountId: string; businessName?: string | null };
};

const emptySummary: Summary = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  inlineLinkClicks: 0,
  leads: 0,
  conversations: 0,
  purchases: 0,
  revenue: 0,
  frequency: 0,
  cpm: 0,
  ctr: 0,
  linkCtr: 0,
  cpc: 0,
  costPerLead: 0,
  costPerConversation: 0,
  costPerPurchase: 0,
  roas: 0,
};

const n = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: unknown) => n(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = (value: unknown) => Math.round(n(value)).toLocaleString('pt-BR');
const decimal = (value: unknown) => n(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (value: unknown) => `${decimal(value)}%`;
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

function MetricCard({ label, value, helper, icon: Icon }: {
  label: string;
  value: string;
  helper: string;
  icon: typeof WalletCards;
}) {
  return (
    <article className="rounded-[12px] border border-[#dde4df] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-400">{label}</p>
          <p className="mt-2.5 tabular-nums text-[24px] font-bold tracking-[-0.035em] text-[#152219]">{value}</p>
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-[#edf3ef] text-[#176846]">
          <Icon size={17} strokeWidth={1.8} />
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-5 text-slate-500">{helper}</p>
    </article>
  );
}

export default function DashboardScoped() {
  const [context, setContext] = useState<DashboardContext | null>(null);
  const [clientId, setClientId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [since, setSince] = useState(isoDaysAgo(29));
  const [until, setUntil] = useState(isoToday());
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
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

  function scopeParams() {
    return {
      clientId,
      since,
      until,
      ...(businessId ? { businessId } : {}),
      ...(adAccountId ? { adAccountId } : {}),
    };
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
      const params = scopeParams();
      const [summaryResponse, dailyResponse, campaignsResponse] = await Promise.all([
        api.get('/performance/summary', { params }),
        api.get('/performance/daily', { params }),
        api.get('/performance/campaigns', { params }),
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

  useEffect(() => {
    void loadContext().catch(() => {
      setError('Não foi possível carregar o contexto de empresas e contas deste acesso.');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!context || !clientId) return;
    void loadData();
    const timer = window.setInterval(() => { void loadData(true); }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [context, clientId, businessId, adAccountId, since, until]);

  const clients = context?.clients ?? [];
  const assignedAccounts = useMemo(
    () => (context?.accounts ?? []).filter((item) => item.clientId === clientId && item.isAssigned),
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

  const selectedClient = clients.find((client) => client.id === clientId);
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'ACTIVE').length;
  const noResultCampaigns = campaigns.filter((campaign) => n(campaign.spend) > 0 && n(campaign.leads) === 0 && n(campaign.conversations) === 0 && n(campaign.purchases) === 0).length;
  const topCampaigns = [...campaigns].sort((a, b) => n(b.spend) - n(a.spend)).slice(0, 8);

  async function sync() {
    if (!clientId) return;
    setSyncing(true);
    setError('');
    try {
      await api.post('/performance/sync', { clientId, since, until });
      await Promise.all([loadContext(), loadData(true)]);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'A sincronização não foi concluída. Tente novamente.');
    } finally {
      setSyncing(false);
    }
  }

  function changeClient(value: string) {
    setClientId(value);
    setBusinessId('');
    setAdAccountId('');
    if (value) localStorage.setItem('gestaoAdsClientId', value);
  }

  function changeBusiness(value: string) {
    setBusinessId(value);
    setAdAccountId('');
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

  return (
    <div className="space-y-5">
      <section className="rounded-[14px] border border-[#dfe5e1] bg-white px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[#176846]">Central de mídia paga</p>
            <h1 className="mt-1.5 text-[28px] font-bold tracking-[-0.035em] text-[#142119]">Dashboard Executivo</h1>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-slate-500">Indicadores reais filtrados por empresa, Business Manager, conta e período para apoiar decisões de mídia.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden rounded-[10px] border border-[#e2e7e3] bg-[#fafbfa] px-3.5 py-2.5 sm:block">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Clock3 size={14} className="text-[#176846]" />{lastUpdated ? lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Aguardando'}</div>
              <p className="mt-0.5 text-[11px] text-slate-400">Leitura automática a cada 5 min</p>
            </div>
            <button type="button" onClick={() => { void sync(); }} disabled={!clientId || syncing || assignedAccounts.length === 0} className="inline-flex h-11 items-center gap-2 rounded-[9px] bg-[#176846] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#12563a] disabled:cursor-not-allowed disabled:opacity-55"><RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Sincronizando...' : 'Sincronizar Meta'}</button>
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-[#dfe5e1] bg-[#fafbfa] p-4">
        <div className="mb-3 flex items-center gap-2"><Building2 size={16} className="text-[#176846]" /><div><h2 className="text-sm font-semibold text-[#1c2b22]">Escopo dos dados</h2><p className="text-[11px] text-slate-500">Todos os cards, gráficos e campanhas obedecem aos filtros abaixo.</p></div></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Empresa<select value={clientId} onChange={(event) => changeClient(event.target.value)} disabled={Boolean(context?.tenantLocked)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none disabled:bg-[#f2f4f2]">{!clients.length && <option value="">Nenhuma empresa disponível</option>}{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Business Manager<select value={businessId} onChange={(event) => changeBusiness(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none"><option value="">Todas as BMs vinculadas</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Conta Meta Ads<select value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none"><option value="">Todas as contas vinculadas</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.accountId}</option>)}</select></label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Período rápido<select defaultValue="30" onChange={(event) => applyPreset(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none"><option value="today">Hoje</option><option value="7">Últimos 7 dias</option><option value="14">Últimos 14 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="month">Este mês</option></select></label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:max-w-xl">
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500"><span className="inline-flex items-center gap-1.5"><CalendarRange size={13} /> Data inicial</span><input type="date" value={since} max={until} onChange={(event) => setSince(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none" /></label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500"><span className="inline-flex items-center gap-1.5"><CalendarRange size={13} /> Data final</span><input type="date" value={until} min={since} max={isoToday()} onChange={(event) => setUntil(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none" /></label>
        </div>
        {selectedClient && <p className="mt-3 text-[11px] text-slate-400">Visualizando: <span className="font-semibold text-slate-600">{selectedClient.name}</span> · {assignedAccounts.length} conta{assignedAccounts.length === 1 ? '' : 's'} vinculada{assignedAccounts.length === 1 ? '' : 's'} · {since.split('-').reverse().join('/')} a {until.split('-').reverse().join('/')}</p>}
      </section>

      {!loading && clientId && assignedAccounts.length === 0 && !error && <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Nenhuma conta Meta foi vinculada a esta empresa.</p>}
      {error && <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" role="alert">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={WalletCards} label="Investimento" value={loading ? '—' : money(summary.spend)} helper={`${integer(summary.reach)} pessoas alcançadas`} />
        <MetricCard icon={Target} label="Leads" value={loading ? '—' : integer(summary.leads)} helper={`CPL: ${money(summary.costPerLead)}`} />
        <MetricCard icon={MessageCircle} label="Conversas" value={loading ? '—' : integer(summary.conversations)} helper={`Custo por conversa: ${money(summary.costPerConversation)}`} />
        <MetricCard icon={ShoppingCart} label="Compras" value={loading ? '—' : integer(summary.purchases)} helper={`CPA: ${money(summary.costPerPurchase)}`} />
        <MetricCard icon={TrendingUp} label="Receita / ROAS" value={loading ? '—' : `${money(summary.revenue)} · ${decimal(summary.roas)}x`} helper="Receita depende do valor de compra retornado pela Meta." />
        <MetricCard icon={MousePointerClick} label="CTR" value={loading ? '—' : pct(summary.ctr)} helper={`CPC: ${money(summary.cpc)} · cliques: ${integer(summary.clicks)}`} />
        <MetricCard icon={Activity} label="Alcance" value={loading ? '—' : integer(summary.reach)} helper={`Frequência média: ${decimal(summary.frequency)}`} />
        <MetricCard icon={BarChart3} label="Impressões" value={loading ? '—' : integer(summary.impressions)} helper={`CPM médio: ${money(summary.cpm)}`} />
        <MetricCard icon={Megaphone} label="Campanhas ativas" value={loading ? '—' : integer(activeCampaigns)} helper={`${integer(campaigns.length)} campanhas no escopo.`} />
        <MetricCard icon={Target} label="Gasto sem resultado" value={loading ? '—' : integer(noResultCampaigns)} helper="Campanhas com investimento e sem lead, conversa ou compra no período." />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[12px] border border-[#dfe5e1] bg-white p-4">
          <div className="mb-4"><h2 className="text-[15px] font-semibold text-[#17251c]">Evolução do investimento</h2><p className="mt-0.5 text-[11px] text-slate-400">Série diária no período selecionado.</p></div>
          <ResponsiveContainer width="100%" height={260}><LineChart data={daily} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}><CartesianGrid stroke="#edf0ee" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5).split('-').reverse().join('/')} tickLine={false} axisLine={false} fontSize={11} stroke="#87948c" /><YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#87948c" /><Tooltip contentStyle={{ border: '1px solid #dde4df', borderRadius: 8, boxShadow: 'none', fontSize: 12 }} /><Line type="monotone" dataKey="spend" name="Investimento" stroke="#176846" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        </div>
        <div className="rounded-[12px] border border-[#dfe5e1] bg-white p-4">
          <div className="mb-4"><h2 className="text-[15px] font-semibold text-[#17251c]">Resultados diários</h2><p className="mt-0.5 text-[11px] text-slate-400">Leads, conversas e compras no mesmo escopo.</p></div>
          <ResponsiveContainer width="100%" height={260}><BarChart data={daily} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}><CartesianGrid stroke="#edf0ee" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5).split('-').reverse().join('/')} tickLine={false} axisLine={false} fontSize={11} stroke="#87948c" /><YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#87948c" /><Tooltip contentStyle={{ border: '1px solid #dde4df', borderRadius: 8, boxShadow: 'none', fontSize: 12 }} /><Bar dataKey="leads" name="Leads" fill="#176846" radius={[3, 3, 0, 0]} /><Bar dataKey="conversations" name="Conversas" fill="#8ba799" radius={[3, 3, 0, 0]} /><Bar dataKey="purchases" name="Compras" fill="#46574e" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
        </div>
      </section>

      <section className="overflow-hidden rounded-[12px] border border-[#dfe5e1] bg-white">
        <div className="border-b border-[#e8ece9] px-4 py-3.5"><h2 className="text-[15px] font-semibold text-[#17251c]">Campanhas com maior investimento</h2><p className="mt-0.5 text-[11px] text-slate-400">Resultados filtrados por empresa, BM, conta e período.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1420px] text-sm">
            <thead className="bg-[#fafbfa] text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"><tr><th className="px-4 py-3">Campanha</th><th className="px-3 py-3">BM / Conta</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Investimento</th><th className="px-3 py-3">Leads</th><th className="px-3 py-3">CPL</th><th className="px-3 py-3">Conversas</th><th className="px-3 py-3">Compras</th><th className="px-3 py-3">CPA</th><th className="px-3 py-3">CTR</th><th className="px-3 py-3">CPC</th><th className="px-4 py-3">ROAS</th></tr></thead>
            <tbody>{topCampaigns.map((campaign) => <tr key={campaign.id} className="border-t border-[#eef1ef] text-[13px]"><td className="px-4 py-3.5 font-semibold text-[#1a2820]">{campaign.name}</td><td className="px-3 py-3.5 text-slate-500">{campaign.adAccount?.businessName || 'BM não identificada'} · {campaign.adAccount?.name || campaign.adAccount?.accountId || '-'}</td><td className="px-3 py-3.5 text-slate-500">{campaign.status || '-'}</td><td className="px-3 py-3.5 tabular-nums">{money(campaign.spend)}</td><td className="px-3 py-3.5 tabular-nums">{integer(campaign.leads)}</td><td className="px-3 py-3.5 tabular-nums">{money(campaign.costPerLead)}</td><td className="px-3 py-3.5 tabular-nums">{integer(campaign.conversations)}</td><td className="px-3 py-3.5 tabular-nums">{integer(campaign.purchases)}</td><td className="px-3 py-3.5 tabular-nums">{money(campaign.costPerPurchase)}</td><td className="px-3 py-3.5 tabular-nums">{pct(campaign.ctr)}</td><td className="px-3 py-3.5 tabular-nums">{money(campaign.cpc)}</td><td className="px-4 py-3.5 tabular-nums font-semibold">{decimal(campaign.roas)}x</td></tr>)}</tbody>
          </table>
        </div>
        {!loading && !topCampaigns.length && <p className="px-4 py-8 text-sm text-slate-500">Nenhuma campanha encontrada neste escopo e período.</p>}
      </section>
    </div>
  );
}
