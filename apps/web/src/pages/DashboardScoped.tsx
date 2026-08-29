import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Building2,
  Clock3,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  Target,
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
  leads: number;
  conversations: number;
  frequency: number;
  cpm: number;
  ctr: number;
  cpc: number;
  costPerLead: number;
  costPerConversation: number;
};
type DailyPoint = { date: string; spend: number; leads: number; conversations: number };
type CampaignRow = {
  id: string;
  name: string;
  objective?: string | null;
  status?: string | null;
  spend: number;
  impressions: number;
  leads: number;
  conversations: number;
  cpc: number;
  adAccount?: { name?: string | null; accountId: string; businessName?: string | null };
};

const emptySummary: Summary = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  leads: 0,
  conversations: 0,
  frequency: 0,
  cpm: 0,
  ctr: 0,
  cpc: 0,
  costPerLead: 0,
  costPerConversation: 0,
};

const n = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: unknown) => n(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = (value: unknown) => Math.round(n(value)).toLocaleString('pt-BR');
const pct = (value: unknown) => `${n(value).toFixed(2)}%`;

function MetricCard({ label, value, helper, icon: Icon }: {
  label: string;
  value: string;
  helper: string;
  icon: typeof WalletCards;
}) {
  return (
    <article className="rounded-[12px] border border-[#dde4df] bg-white p-4.5 shadow-[0_1px_2px_rgba(16,24,20,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-slate-400">{label}</p>
          <p className="mt-2.5 tabular-nums text-[25px] font-bold tracking-[-0.035em] text-[#152219]">{value}</p>
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
        api.get('/dashboard/scoped/summary', { params }),
        api.get('/dashboard/scoped/daily', { params }),
        api.get('/dashboard/scoped/campaigns', { params }),
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
  }, [context, clientId, businessId, adAccountId]);

  const clients = context?.clients ?? [];
  const businesses = useMemo(
    () => (context?.businesses ?? []).filter((item) => item.clientId === clientId),
    [context, clientId],
  );
  const accounts = useMemo(
    () => (context?.accounts ?? []).filter((item) => item.clientId === clientId && (!businessId || item.businessId === businessId)),
    [context, clientId, businessId],
  );

  const selectedClient = clients.find((client) => client.id === clientId);
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'ACTIVE').length;
  const noLeadCampaigns = campaigns.filter((campaign) => n(campaign.spend) > 0 && n(campaign.leads) === 0).length;
  const topCampaigns = [...campaigns].sort((a, b) => n(b.spend) - n(a.spend)).slice(0, 6);

  async function sync() {
    if (!clientId) return;
    setSyncing(true);
    setError('');
    try {
      await api.post('/dashboard/scoped/sync', { clientId });
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

  return (
    <div className="space-y-5">
      <section className="rounded-[14px] border border-[#dfe5e1] bg-white px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[#176846]">Central de mídia paga</p>
            <h1 className="mt-1.5 text-[28px] font-bold tracking-[-0.035em] text-[#142119]">Dashboard Executivo</h1>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-slate-500">
              Indicadores reais da empresa e das contas Meta autorizadas, sem mistura de dados entre clientes.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden rounded-[10px] border border-[#e2e7e3] bg-[#fafbfa] px-3.5 py-2.5 sm:block">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Clock3 size={14} className="text-[#176846]" />
                {lastUpdated ? lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Aguardando'}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">Atualização automática a cada 5 min</p>
            </div>
            <button
              type="button"
              onClick={() => { void sync(); }}
              disabled={!clientId || syncing}
              className="inline-flex h-11 items-center gap-2 rounded-[9px] bg-[#176846] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#12563a] disabled:cursor-not-allowed disabled:opacity-55"
            >
              <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Atualizando...' : 'Atualizar agora'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[12px] border border-[#dfe5e1] bg-[#fafbfa] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Building2 size={16} className="text-[#176846]" />
          <div>
            <h2 className="text-sm font-semibold text-[#1c2b22]">Escopo dos dados</h2>
            <p className="text-[11px] text-slate-500">Empresa, BM e conta determinam todos os números exibidos abaixo.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">
            Empresa
            <select
              value={clientId}
              onChange={(event) => changeClient(event.target.value)}
              disabled={Boolean(context?.tenantLocked)}
              className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-[#8db49f] disabled:bg-[#f2f4f2]"
            >
              {!clients.length && <option value="">Nenhuma empresa disponível</option>}
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>

          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">
            Business Manager
            <select
              value={businessId}
              onChange={(event) => changeBusiness(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-[#8db49f]"
            >
              <option value="">Todas as BMs</option>
              {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          </label>

          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">
            Conta Meta Ads
            <select
              value={adAccountId}
              onChange={(event) => setAdAccountId(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-700 outline-none focus:border-[#8db49f]"
            >
              <option value="">Todas as contas</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name || account.accountId}{account.isActive ? '' : ' · desconectada'}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedClient && <p className="mt-3 text-[11px] text-slate-400">Visualizando: <span className="font-semibold text-slate-600">{selectedClient.name}</span></p>}
      </section>

      {error && (
        <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800" role="alert">{error}</p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={WalletCards} label="Investimento" value={loading ? '—' : money(summary.spend)} helper="Investimento sincronizado no escopo atual." />
        <MetricCard icon={Target} label="Leads" value={loading ? '—' : integer(summary.leads)} helper={`CPL: ${money(summary.costPerLead)}`} />
        <MetricCard icon={MessageCircle} label="Conversas" value={loading ? '—' : integer(summary.conversations)} helper={`Custo por conversa: ${money(summary.costPerConversation)}`} />
        <MetricCard icon={MousePointerClick} label="CTR" value={loading ? '—' : pct(summary.ctr)} helper={`CPC médio: ${money(summary.cpc)}`} />
        <MetricCard icon={Activity} label="Alcance" value={loading ? '—' : integer(summary.reach)} helper={`Frequência média: ${n(summary.frequency).toFixed(2)}`} />
        <MetricCard icon={BarChart3} label="Impressões" value={loading ? '—' : integer(summary.impressions)} helper={`CPM médio: ${money(summary.cpm)}`} />
        <MetricCard icon={Megaphone} label="Campanhas ativas" value={loading ? '—' : integer(activeCampaigns)} helper={`${integer(campaigns.length)} campanhas no escopo.`} />
        <MetricCard icon={Target} label="Gasto sem lead" value={loading ? '—' : integer(noLeadCampaigns)} helper="Campanhas com gasto e nenhum lead no período sincronizado." />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[12px] border border-[#dfe5e1] bg-white p-4.5">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-[#17251c]">Evolução do investimento</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">Série diária dos últimos dados sincronizados.</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={daily} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#edf0ee" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} stroke="#87948c" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#87948c" />
              <Tooltip contentStyle={{ border: '1px solid #dde4df', borderRadius: 8, boxShadow: 'none', fontSize: 12 }} />
              <Line type="monotone" dataKey="spend" name="Investimento" stroke="#176846" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-[12px] border border-[#dfe5e1] bg-white p-4.5">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-[#17251c]">Resultados diários</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">Leads e conversas no mesmo escopo selecionado.</p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={daily} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#edf0ee" vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} stroke="#87948c" />
              <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#87948c" />
              <Tooltip contentStyle={{ border: '1px solid #dde4df', borderRadius: 8, boxShadow: 'none', fontSize: 12 }} />
              <Bar dataKey="leads" name="Leads" fill="#176846" radius={[3, 3, 0, 0]} />
              <Bar dataKey="conversations" name="Conversas" fill="#8ba799" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="overflow-hidden rounded-[12px] border border-[#dfe5e1] bg-white">
        <div className="border-b border-[#e8ece9] px-4 py-3.5">
          <h2 className="text-[15px] font-semibold text-[#17251c]">Campanhas com maior investimento</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Resultados já filtrados por empresa, BM e conta.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-[#fafbfa] text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Campanha</th>
                <th className="px-3 py-3">BM / Conta</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Investimento</th>
                <th className="px-3 py-3">Leads</th>
                <th className="px-3 py-3">Conversas</th>
                <th className="px-4 py-3">CPC</th>
              </tr>
            </thead>
            <tbody>
              {topCampaigns.map((campaign) => (
                <tr key={campaign.id} className="border-t border-[#eef1ef] text-[13px]">
                  <td className="px-4 py-3.5 font-semibold text-[#1a2820]">{campaign.name}</td>
                  <td className="px-3 py-3.5 text-slate-500">
                    {campaign.adAccount?.businessName || 'BM não identificado'} · {campaign.adAccount?.name || campaign.adAccount?.accountId || '-'}
                  </td>
                  <td className="px-3 py-3.5 text-slate-500">{campaign.status || '-'}</td>
                  <td className="px-3 py-3.5 tabular-nums text-slate-700">{money(campaign.spend)}</td>
                  <td className="px-3 py-3.5 tabular-nums text-slate-700">{integer(campaign.leads)}</td>
                  <td className="px-3 py-3.5 tabular-nums text-slate-700">{integer(campaign.conversations)}</td>
                  <td className="px-4 py-3.5 tabular-nums text-slate-700">{money(campaign.cpc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !topCampaigns.length && <p className="px-4 py-8 text-sm text-slate-500">Nenhuma campanha encontrada neste escopo.</p>}
      </section>
    </div>
  );
}
