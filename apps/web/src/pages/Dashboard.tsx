import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Clock3,
  MousePointerClick,
  RefreshCcw,
  Send,
  Target,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import {
  Area,
  AreaChart,
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

type Summary = Record<string, unknown>;
type RawRow = Record<string, unknown>;

type CampaignRow = {
  id: string;
  name: string;
  objective: string;
  status: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  conversations: number;
  ctr: number;
  cpc: number;
  cpm: number;
  dailyBudget: number;
};

type DailyPoint = {
  date: string;
  spend: number;
  leads: number;
};

type AlertRow = {
  id: string;
  title: string;
  message: string;
  severity: string;
  isRead: boolean;
};

type IconType = LucideIcon;

const asNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const asText = (value: unknown, fallback = '-') => {
  return typeof value === 'string' && value.trim() ? value : fallback;
};

const fmt = (value: unknown, currency = false) => {
  const number = asNumber(value);
  return currency
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : number.toLocaleString('pt-BR');
};

const percent = (value: unknown) => `${asNumber(value).toFixed(2)}%`;

function asArray(value: unknown): RawRow[] {
  return Array.isArray(value) ? value.filter((item): item is RawRow => typeof item === 'object' && item !== null) : [];
}

function normalizeCampaign(row: RawRow, index: number): CampaignRow {
  return {
    id: asText(row.id, `campaign-${index}`),
    name: asText(row.name, 'Campanha sem nome'),
    objective: asText(row.objective, 'Objetivo não informado'),
    status: asText(row.status, 'UNKNOWN'),
    spend: asNumber(row.spend),
    impressions: asNumber(row.impressions),
    reach: asNumber(row.reach),
    clicks: asNumber(row.clicks),
    leads: asNumber(row.leads),
    conversations: asNumber(row.conversations),
    ctr: asNumber(row.ctr),
    cpc: asNumber(row.cpc),
    cpm: asNumber(row.cpm),
    dailyBudget: asNumber(row.dailyBudget),
  };
}

function normalizeDaily(row: RawRow, index: number): DailyPoint {
  return {
    date: asText(row.date, `D${index + 1}`),
    spend: asNumber(row.spend),
    leads: asNumber(row.leads),
  };
}

function normalizeAlert(row: RawRow, index: number): AlertRow {
  return {
    id: asText(row.id, `alert-${index}`),
    title: asText(row.title, 'Alerta operacional'),
    message: asText(row.message, 'Verifique os dados sincronizados desta conta.'),
    severity: asText(row.severity, 'INFO'),
    isRead: Boolean(row.isRead),
  };
}

function Card({ icon: Icon, label, value, helper, tone = 'neutral' }: {
  icon: IconType;
  label: string;
  value: string;
  helper: string;
  tone?: 'neutral' | 'primary' | 'warning';
}) {
  const toneClass = tone === 'primary'
    ? 'bg-brand-blue text-white'
    : tone === 'warning'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-[#eef4eb] text-brand-blue';

  return (
    <div className="rounded-2xl border border-brand-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
          <p className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950">{value}</p>
        </div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${toneClass}`}>
          <Icon size={18} />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{helper}</p>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-[180px] place-items-center rounded-2xl border border-dashed border-brand-border bg-[#f8faf6] p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function load(options: { silent?: boolean } = {}) {
    setError('');
    if (!options.silent) setLoading(true);
    try {
      const [summaryResponse, dailyResponse, campaignsResponse, alertsResponse] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/dashboard/daily'),
        api.get('/dashboard/campaigns'),
        api.get('/alerts').catch(() => ({ data: { data: [] } })),
      ]);

      const summaryData = summaryResponse.data?.data;
      setSummary(typeof summaryData === 'object' && summaryData !== null ? summaryData as Summary : {});
      setDaily(asArray(dailyResponse.data?.data).map(normalizeDaily));
      setCampaigns(asArray(campaignsResponse.data?.data).map(normalizeCampaign));
      setAlerts(asArray(alertsResponse.data?.data).map(normalizeAlert).slice(0, 4));
      setLastUpdated(new Date());
    } catch {
      setError('Não foi possível carregar os indicadores. Verifique a conexão com a API e tente novamente.');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function sync() {
    setSyncing(true);
    setError('');
    try {
      await api.post('/dashboard/sync', {});
      await load({ silent: true });
    } catch {
      setError('A sincronização não foi concluída. Confira a integração com a Meta Ads.');
    } finally {
      setSyncing(false);
    }
  }

  const totals = useMemo(() => {
    const spend = asNumber(summary?.spend);
    const totalBudget = campaigns.reduce((acc, campaign) => acc + campaign.dailyBudget, 0);
    const providedPacing = asNumber(summary?.pacing ?? summary?.budgetPacing ?? summary?.budgetPacingPercent);
    const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'ACTIVE').length;
    const noResultSpend = campaigns.filter((campaign) => campaign.spend > 0 && campaign.leads === 0);
    const bestCampaign = [...campaigns]
      .filter((campaign) => campaign.leads > 0)
      .sort((a, b) => a.cpc - b.cpc)[0];
    const spendLeader = [...campaigns].sort((a, b) => b.spend - a.spend)[0];

    return {
      spend,
      totalBudget,
      activeCampaigns,
      noResultSpend,
      bestCampaign,
      spendLeader,
      pacing: providedPacing > 0 ? Math.min(providedPacing, 999) : null,
    };
  }, [campaigns, summary]);

  const topCampaigns = useMemo(() => [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5), [campaigns]);

  if (loading && !summary) {
    return (
      <div className="space-y-5">
        <div className="h-28 animate-pulse rounded-3xl bg-white" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl bg-white" />)}
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-semibold text-red-700">{error || 'Os dados do dashboard não estão disponíveis.'}</p>
        <button onClick={() => { void load(); }} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-blue px-4 py-2 text-sm font-bold text-white">
          <RefreshCcw size={16} />
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-white bg-white/85 p-5 shadow-soft">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-blue">Central de mídia paga</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">Dashboard Executivo</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Visão consolidada das contas autorizadas, com sincronização periódica e indicadores preservados pela fonte conectada.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="rounded-2xl bg-[#f3f7f1] px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                <Clock3 size={16} className="text-brand-blue" />
                {lastUpdated ? lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Aguardando'}
              </div>
              <p className="mt-1 text-xs text-slate-500">Atualização automática a cada 5 min</p>
            </div>
            <button
              onClick={sync}
              disabled={syncing}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand-blue px-5 text-sm font-bold text-white transition hover:bg-brand-purple disabled:opacity-60"
            >
              <RefreshCcw size={17} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Atualizando' : 'Atualizar agora'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700" role="alert">
          {error}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card icon={WalletCards} label="Investimento" value={fmt(summary.spend, true)} helper="Total sincronizado no período disponível." tone="primary" />
        <Card icon={Target} label="Leads" value={fmt(summary.leads)} helper={`CPL atual: ${fmt(summary.costPerLead, true)}.`} />
        <Card icon={Send} label="Conversas" value={fmt(summary.conversations)} helper={`Custo por conversa: ${fmt(summary.costPerConversation, true)}.`} />
        <Card icon={MousePointerClick} label="CTR" value={percent(summary.ctr)} helper={`CPC médio: ${fmt(summary.cpc, true)}.`} />
        <Card icon={Activity} label="Alcance" value={fmt(summary.reach)} helper={`Frequência: ${asNumber(summary.frequency).toFixed(2)}.`} />
        <Card icon={BarChart3} label="Impressões" value={fmt(summary.impressions)} helper={`CPM médio: ${fmt(summary.cpm, true)}.`} />
        <Card icon={BarChart3} label="Campanhas ativas" value={fmt(totals.activeCampaigns)} helper={`${fmt(campaigns.length)} campanhas no escopo atual.`} />
        <Card
          icon={AlertTriangle}
          label="Gasto sem lead"
          value={fmt(totals.noResultSpend.length)}
          helper="Campanhas com investimento e nenhum lead no conjunto retornado."
          tone={totals.noResultSpend.length ? 'warning' : 'neutral'}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="rounded-3xl border border-brand-border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-slate-950">Evolução de investimento</h2>
              <p className="text-xs text-slate-500">Série diária retornada pela API.</p>
            </div>
            <ArrowUpRight className="text-slate-300" size={20} />
          </div>
          {daily.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={daily} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0b6b45" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="#0b6b45" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e7eee4" vertical={false} />
                <XAxis dataKey="date" stroke="#8a998d" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#8a998d" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e1e8dd', borderRadius: 12, color: '#102018' }} />
                <Area type="monotone" dataKey="spend" stroke="#0b6b45" fill="url(#spendFill)" strokeWidth={3} name="Investimento" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>Nenhuma série temporal foi sincronizada para este acesso.</EmptyState>
          )}
        </div>

        <div className="rounded-3xl border border-brand-border bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-extrabold text-slate-950">Orçamento e pacing</h2>
            <p className="text-xs text-slate-500">Exibido somente quando o orçamento vem da fonte conectada.</p>
          </div>
          {totals.pacing === null ? (
            <EmptyState>Indisponível pela fonte conectada.</EmptyState>
          ) : (
            <div>
              <div className="relative h-36">
                <div className="absolute inset-x-4 bottom-0 h-28 rounded-t-full border-[22px] border-[#e8f0e4] border-b-0" />
                <div
                  className="absolute inset-x-4 bottom-0 h-28 rounded-t-full border-[22px] border-brand-blue border-b-0"
                  style={{ clipPath: `inset(0 ${Math.max(0, 100 - totals.pacing)}% 0 0)` }}
                />
                <div className="absolute inset-x-0 bottom-1 text-center">
                  <p className="text-4xl font-extrabold text-slate-950">{totals.pacing.toFixed(0)}%</p>
                  <p className="text-xs font-medium text-slate-500">Consumido do orçamento diário</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-[#f5f8f2] p-3">
                  <p className="text-xs text-slate-500">Investido</p>
                  <p className="font-bold text-slate-950">{fmt(totals.spend, true)}</p>
                </div>
                <div className="rounded-2xl bg-[#f5f8f2] p-3">
                  <p className="text-xs text-slate-500">Orçamento</p>
                  <p className="font-bold text-slate-950">{fmt(totals.totalBudget, true)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-3xl border border-brand-border bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-extrabold text-slate-950">Leads por dia</h2>
            <p className="text-xs text-slate-500">Volume de resultados agregados por data.</p>
          </div>
          {daily.length ? (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={daily} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e7eee4" vertical={false} />
                <XAxis dataKey="date" stroke="#8a998d" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#8a998d" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e1e8dd', borderRadius: 12, color: '#102018' }} />
                <Bar dataKey="leads" fill="#62b783" radius={[12, 12, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
          <EmptyState>Nenhum resultado diário disponível.</EmptyState>
          )}
        </div>

        <div className="rounded-3xl border border-brand-border bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-extrabold text-slate-950">Leitura operacional</h2>
            <p className="text-xs text-slate-500">Sinais derivados dos dados sincronizados.</p>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl bg-[#f5f8f2] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Maior investimento</p>
              <p className="mt-1 font-bold text-slate-950">{totals.spendLeader?.name || 'Indisponível pela fonte conectada'}</p>
              <p className="mt-1 text-sm text-slate-500">{totals.spendLeader ? fmt(totals.spendLeader.spend, true) : 'Sem campanha sincronizada.'}</p>
            </div>
            <div className="rounded-2xl bg-[#f5f8f2] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Melhor custo por clique</p>
              <p className="mt-1 font-bold text-slate-950">{totals.bestCampaign?.name || 'Indisponível pela fonte conectada'}</p>
              <p className="mt-1 text-sm text-slate-500">{totals.bestCampaign ? fmt(totals.bestCampaign.cpc, true) : 'Amostra insuficiente para leitura.'}</p>
            </div>
            <div className="rounded-2xl bg-[#fff7ed] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-600">Atenção</p>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                {totals.noResultSpend.length
                  ? `${totals.noResultSpend.length} campanha(s) tiveram gasto sem lead no retorno atual.`
                  : 'Nenhuma campanha com gasto sem lead no retorno atual.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.9fr]">
        <div className="rounded-3xl border border-brand-border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-extrabold text-slate-950">Campanhas por investimento</h2>
              <p className="text-xs text-slate-500">Ranking de leitura rápida do período.</p>
            </div>
          </div>
          {topCampaigns.length ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={topCampaigns} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e7eee4" vertical={false} />
                <XAxis dataKey="name" stroke="#8a998d" fontSize={11} tickLine={false} axisLine={false} interval={0} tickFormatter={(value) => String(value).slice(0, 12)} />
                <YAxis stroke="#8a998d" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e1e8dd', borderRadius: 12, color: '#102018' }} />
                <Line type="monotone" dataKey="spend" stroke="#123d2d" strokeWidth={3} dot={{ r: 4, fill: '#123d2d' }} name="Investimento" />
                <Line type="monotone" dataKey="leads" stroke="#62b783" strokeWidth={3} dot={{ r: 4, fill: '#62b783' }} name="Leads" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>Nenhuma campanha sincronizada para ranquear.</EmptyState>
          )}
        </div>

        <div className="rounded-3xl border border-brand-border bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-extrabold text-slate-950">Alertas recentes</h2>
            <p className="text-xs text-slate-500">Eventos registrados pela API.</p>
          </div>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className={`rounded-2xl p-4 ${alert.isRead ? 'bg-[#f5f8f2]' : 'bg-amber-50'}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${alert.severity === 'CRITICAL' ? 'bg-red-500' : alert.severity === 'WARNING' ? 'bg-amber-500' : 'bg-brand-blue'}`} />
                  <div>
                    <p className="text-sm font-bold text-slate-950">{alert.title}</p>
                    <p className="mt-1 text-sm leading-5 text-slate-500">{alert.message}</p>
                  </div>
                </div>
              </div>
            ))}
            {!alerts.length && <EmptyState>Nenhum alerta operacional registrado.</EmptyState>}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-brand-border bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-extrabold text-slate-950">Campanhas sincronizadas</h2>
            <p className="text-xs text-slate-500">Dados exibidos conforme retorno autorizado da Meta/API.</p>
          </div>
          <span className="rounded-full bg-[#edf3ea] px-3 py-1 text-xs font-bold text-brand-blue">{campaigns.length} campanhas</span>
        </div>

        <div className="premium-scrollbar overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.12em] text-slate-400">
              <tr>
                <th className="py-3 pr-4">Campanha</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Investimento</th>
                <th className="py-3 pr-4">Leads</th>
                <th className="py-3 pr-4">Conversas</th>
                <th className="py-3 pr-4">CTR</th>
                <th className="py-3 pr-4">CPC</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="border-t border-brand-border">
                  <td className="py-4 pr-4">
                    <p className="font-bold text-slate-950">{campaign.name}</p>
                    <p className="text-xs text-slate-500">{campaign.objective}</p>
                  </td>
                  <td className="py-4 pr-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${campaign.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {campaign.status}
                    </span>
                  </td>
                  <td className="py-4 pr-4 font-semibold text-slate-800">{fmt(campaign.spend, true)}</td>
                  <td className="py-4 pr-4 text-slate-700">{fmt(campaign.leads)}</td>
                  <td className="py-4 pr-4 text-slate-700">{fmt(campaign.conversations)}</td>
                  <td className="py-4 pr-4 text-slate-700">{percent(campaign.ctr)}</td>
                  <td className="py-4 pr-4 text-slate-700">{fmt(campaign.cpc, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!campaigns.length && <p className="py-5 text-sm text-slate-500">Nenhuma campanha sincronizada para este acesso.</p>}
      </section>
    </div>
  );
}
