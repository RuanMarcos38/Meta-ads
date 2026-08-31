import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, CalendarRange, CheckCircle2, Database, Megaphone, MessageCircle, MousePointerClick, RefreshCw, ShoppingCart, Target, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useScope } from '../store';

type Summary = {
  spend: number; impressions: number; reach: number; clicks: number; inlineLinkClicks: number;
  leads: number; conversations: number; purchases: number; revenue: number; frequency: number;
  cpm: number; ctr: number; linkCtr: number; cpc: number; costPerLead: number;
  costPerConversation: number; costPerPurchase: number; roas: number;
};
type Campaign = Summary & { id: string; metaCampaignId: string; name: string; status?: string | null; objective?: string | null; adSetCount?: number; adAccount?: { id: string; name?: string | null; accountId: string; businessName?: string | null } };
type Daily = { date: string; spend: number; leads: number; conversations: number; purchases: number; revenue: number };
type Health = { businessId: string; businessName: string; lastSyncAt?: string | null; lastSyncStatus?: string; tokenStatus?: string; earliestDate?: string | null; latestDate?: string | null; assignedAccountCount?: number };

const empty: Summary = { spend: 0, impressions: 0, reach: 0, clicks: 0, inlineLinkClicks: 0, leads: 0, conversations: 0, purchases: 0, revenue: 0, frequency: 0, cpm: 0, ctr: 0, linkCtr: 0, cpc: 0, costPerLead: 0, costPerConversation: 0, costPerPurchase: 0, roas: 0 };
const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v: unknown) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = (v: unknown) => Math.round(num(v)).toLocaleString('pt-BR');
const decimal = (v: unknown) => num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: unknown) => `${decimal(v)}%`;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };

function Card({ label, value, helper, icon: Icon }: { label: string; value: string; helper: string; icon: typeof WalletCards }) {
  return <article className="corporate-card p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="section-kicker">{label}</p><strong className="mt-2 block tabular-nums text-[22px] tracking-[-0.03em] text-[#142119]">{value}</strong></div><span className="metric-icon"><Icon size={15} /></span></div><p className="mt-2 text-[10px] leading-4 text-slate-500">{helper}</p></article>;
}

function delta(current: number, previous: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return (current - previous) / Math.abs(previous) * 100;
}

export default function DashboardPro() {
  const scope = useScope();
  const [since, setSince] = useState(daysAgo(29));
  const [until, setUntil] = useState(today());
  const [campaignId, setCampaignId] = useState('');
  const [summary, setSummary] = useState<Summary>(empty);
  const [previous, setPrevious] = useState<Summary>(empty);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState(true);
  const [search, setSearch] = useState('');

  const params = useMemo(() => ({
    clientId: scope.clientId,
    ...(scope.businessId ? { businessId: scope.businessId } : {}),
    ...(scope.adAccountId ? { adAccountId: scope.adAccountId } : {}),
    ...(campaignId ? { campaignId } : {}),
    since,
    until,
  }), [scope.clientId, scope.businessId, scope.adAccountId, campaignId, since, until]);

  function previousPeriod() {
    const a = new Date(`${since}T00:00:00`);
    const b = new Date(`${until}T00:00:00`);
    const span = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
    const end = new Date(a); end.setDate(end.getDate() - 1);
    const start = new Date(end); start.setDate(start.getDate() - span + 1);
    return { since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) };
  }

  async function load(silent = false) {
    if (!scope.clientId) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const campaignParams = { ...params }; delete (campaignParams as any).campaignId;
      const prev = previousPeriod();
      const [summaryResponse, campaignsResponse, dailyResponse, previousResponse, healthResponse] = await Promise.all([
        api.get('/performance/summary', { params }),
        api.get('/performance/campaigns', { params: campaignParams }),
        api.get('/performance/daily', { params }),
        compare ? api.get('/performance/summary', { params: { ...params, ...prev } }) : Promise.resolve(null),
        api.get('/workspace/integration-health', { params: { clientId: scope.clientId, ...(scope.businessId ? { businessId: scope.businessId } : {}) } }).catch(() => null),
      ]);
      setSummary({ ...empty, ...(summaryResponse.data?.data || {}) });
      setPrevious({ ...empty, ...(previousResponse?.data?.data || {}) });
      setCampaigns(Array.isArray(campaignsResponse.data?.data) ? campaignsResponse.data.data : []);
      setDaily(Array.isArray(dailyResponse.data?.data) ? dailyResponse.data.data : []);
      const healthRows = healthResponse?.data?.data;
      setHealth(Array.isArray(healthRows) ? healthRows[0] || null : null);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || requestError?.response?.data?.message || 'Não foi possível carregar as métricas deste escopo.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [params.clientId, params.businessId, params.adAccountId, params.campaignId, params.since, params.until, compare]);
  useEffect(() => { const id = window.setInterval(() => { void load(true); }, 5 * 60 * 1000); return () => window.clearInterval(id); }, [params]);

  async function sync() {
    if (!scope.clientId) return;
    setSyncing(true); setError('');
    try {
      if (scope.businessId) {
        const manager = scope.businesses.find((item) => item.clientId === scope.clientId && item.metaBusinessId === scope.businessId);
        if (manager) await api.post(`/workspace/business-managers/${manager.id}/sync`, { since, until });
        else await api.post('/performance/sync', { clientId: scope.clientId, since, until });
      } else {
        await api.post('/performance/sync', { clientId: scope.clientId, since, until });
      }
      await load(true);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || 'A sincronização não foi concluída.');
    } finally { setSyncing(false); }
  }

  function preset(value: string) {
    const end = today(); setUntil(end);
    if (value === 'today') setSince(end);
    if (value === '7') setSince(daysAgo(6));
    if (value === '14') setSince(daysAgo(13));
    if (value === '30') setSince(daysAgo(29));
    if (value === '90') setSince(daysAgo(89));
    if (value === 'month') setSince(`${end.slice(0, 8)}01`);
    if (value === 'year') setSince(`${end.slice(0, 4)}-01-01`);
    if (value === 'history' && health?.earliestDate) setSince(String(health.earliestDate).slice(0, 10));
  }

  const filtered = campaigns.filter((item) => !search.trim() || [item.name, item.adAccount?.name, item.adAccount?.businessName].some((v) => String(v || '').toLowerCase().includes(search.trim().toLowerCase()))).sort((a, b) => b.spend - a.spend);
  const selectedCampaign = campaigns.find((item) => item.metaCampaignId === campaignId);
  const comparison = [
    ['Investimento', summary.spend, previous.spend], ['Leads', summary.leads, previous.leads], ['Conversas', summary.conversations, previous.conversations], ['CTR', summary.ctr, previous.ctr], ['CPL', summary.costPerLead, previous.costPerLead], ['ROAS', summary.roas, previous.roas],
  ];

  return <div className="space-y-4">
    <section className="page-heading"><div><p className="section-kicker">Desempenho</p><h1>Dashboard</h1><p>Resumo da BM e detalhamento por campanha, conta e período. Nenhum resultado de outra empresa entra neste escopo.</p></div><div className="flex flex-wrap items-center gap-2"><span className={`status-chip ${health?.lastSyncStatus === 'success' ? 'status-success' : 'status-neutral'}`}><CheckCircle2 size={12} />{health?.lastSyncAt ? `Atualizado ${new Date(health.lastSyncAt).toLocaleString('pt-BR')}` : 'Aguardando sincronização'}</span><button className="primary-button" disabled={!scope.clientId || syncing} onClick={() => { void sync(); }}><RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Sincronizando' : 'Sincronizar'}</button></div></section>

    <section className="filter-panel"><div className="grid gap-2 md:grid-cols-[180px_1fr_1fr_auto] md:items-end"><label className="field-label">Período<select defaultValue="30" onChange={(e) => preset(e.target.value)} className="field-control"><option value="today">Hoje</option><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="month">Este mês</option><option value="year">Este ano</option>{health?.earliestDate && <option value="history">Todo histórico</option>}</select></label><label className="field-label"><span><CalendarRange size={12} /> Data inicial</span><input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} className="field-control" /></label><label className="field-label"><span><CalendarRange size={12} /> Data final</span><input type="date" value={until} min={since} max={today()} onChange={(e) => setUntil(e.target.value)} className="field-control" /></label><label className="flex h-9 items-center gap-2 rounded-[7px] border border-[#d9e0dc] bg-white px-3 text-[11px] font-medium text-slate-600"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Comparar período anterior</label></div>{selectedCampaign && <div className="mt-3 flex items-center justify-between border-t border-[#e2e7e4] pt-3 text-[11px]"><span>Campanha selecionada: <strong>{selectedCampaign.name}</strong></span><button className="text-button" onClick={() => setCampaignId('')}>Voltar ao resumo</button></div>}</section>

    {error && <div className="message-warning">{error}</div>}

    <section className="metric-grid"><Card label="Investimento" value={loading ? '—' : money(summary.spend)} helper={`Alcance ${integer(summary.reach)}`} icon={WalletCards} /><Card label="Leads" value={loading ? '—' : integer(summary.leads)} helper={`CPL ${money(summary.costPerLead)}`} icon={Target} /><Card label="Conversas" value={loading ? '—' : integer(summary.conversations)} helper={`Custo ${money(summary.costPerConversation)}`} icon={MessageCircle} /><Card label="Compras" value={loading ? '—' : integer(summary.purchases)} helper={`CPA ${money(summary.costPerPurchase)}`} icon={ShoppingCart} /><Card label="ROAS" value={loading ? '—' : `${decimal(summary.roas)}x`} helper={`Receita ${money(summary.revenue)}`} icon={TrendingUp} /><Card label="CTR" value={loading ? '—' : pct(summary.ctr)} helper={`CPC ${money(summary.cpc)}`} icon={MousePointerClick} /><Card label="Alcance" value={loading ? '—' : integer(summary.reach)} helper={`Frequência ${decimal(summary.frequency)}`} icon={Activity} /><Card label="Impressões" value={loading ? '—' : integer(summary.impressions)} helper={`CPM ${money(summary.cpm)}`} icon={BarChart3} /></section>

    {compare && <section className="corporate-card p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="panel-title">Comparativo com período anterior</h2><p className="panel-subtitle">Variação percentual usando um intervalo anterior de mesma duração.</p></div></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">{comparison.map(([label, current, old]) => { const d = delta(Number(current), Number(old)); const good = label === 'CPL' ? d <= 0 : d >= 0; return <div key={String(label)} className="rounded-[7px] border border-[#e0e5e2] p-3"><p className="text-[10px] text-slate-400">{label}</p><div className={`mt-1 flex items-center gap-1 text-[12px] font-semibold ${good ? 'text-emerald-700' : 'text-red-600'}`}>{d >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(d).toFixed(1)}%</div></div>; })}</div></section>}

    <section className="grid gap-4 xl:grid-cols-2"><div className="corporate-card p-4"><h2 className="panel-title">Evolução do investimento</h2><p className="panel-subtitle">Período e campanha selecionados.</p><div className="mt-4 h-[260px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={daily}><CartesianGrid stroke="#edf0ee" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} width={45} /><Tooltip formatter={(v: any) => money(v)} /><Line type="monotone" dataKey="spend" stroke="#176846" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></div><div className="corporate-card p-4"><h2 className="panel-title">Resultados por dia</h2><p className="panel-subtitle">Leads e conversas no mesmo intervalo.</p><div className="mt-4 h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={daily}><CartesianGrid stroke="#edf0ee" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} width={35} /><Tooltip /><Bar dataKey="leads" fill="#176846" radius={[3,3,0,0]} /><Bar dataKey="conversations" fill="#92aa9c" radius={[3,3,0,0]} /></BarChart></ResponsiveContainer></div></div></section>

    <section className="corporate-card overflow-hidden"><div className="flex flex-col gap-3 border-b border-[#e2e7e4] p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="panel-title">Campanhas</h2><p className="panel-subtitle">Clique em uma campanha para recalcular todo o dashboard apenas com ela.</p></div><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar campanha" className="field-control sm:w-[260px]" /></div><div className="table-scroll"><table className="corporate-table"><thead><tr><th>Campanha</th><th>Status</th><th>Conta</th><th>Investimento</th><th>Leads</th><th>CPL</th><th>Conversas</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Compras</th><th>CPA</th><th>ROAS</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className={campaignId === row.metaCampaignId ? 'bg-[#f2f7f4]' : ''} onClick={() => setCampaignId(row.metaCampaignId)}><td><strong>{row.name}</strong><small>{row.objective || '—'}</small></td><td><span className="status-chip status-neutral">{row.status || '—'}</span></td><td>{row.adAccount?.name || row.adAccount?.accountId}</td><td>{money(row.spend)}</td><td>{integer(row.leads)}</td><td>{money(row.costPerLead)}</td><td>{integer(row.conversations)}</td><td>{pct(row.ctr)}</td><td>{money(row.cpc)}</td><td>{money(row.cpm)}</td><td>{integer(row.purchases)}</td><td>{money(row.costPerPurchase)}</td><td>{decimal(row.roas)}x</td></tr>)}{!filtered.length && <tr><td colSpan={13}><div className="empty-state"><Megaphone size={20} /><span>Nenhuma campanha encontrada neste escopo e período.</span></div></td></tr>}</tbody></table></div></section>

    <section className="grid gap-3 md:grid-cols-3"><div className="corporate-card p-4"><Database size={16} className="text-[#176846]" /><h3 className="mt-2 text-[12px] font-semibold">Qualidade dos dados</h3><p className="mt-1 text-[10px] text-slate-500">{health?.earliestDate ? `Histórico de ${new Date(health.earliestDate).toLocaleDateString('pt-BR')} até ${health.latestDate ? new Date(health.latestDate).toLocaleDateString('pt-BR') : 'hoje'}.` : 'Histórico ainda não identificado.'}</p></div><div className="corporate-card p-4"><CheckCircle2 size={16} className="text-[#176846]" /><h3 className="mt-2 text-[12px] font-semibold">Integração</h3><p className="mt-1 text-[10px] text-slate-500">Token: {health?.tokenStatus || '—'} · {health?.assignedAccountCount || 0} conta(s) autorizada(s).</p></div><div className="corporate-card p-4"><Megaphone size={16} className="text-[#176846]" /><h3 className="mt-2 text-[12px] font-semibold">Campanhas no escopo</h3><p className="mt-1 text-[10px] text-slate-500">{campaigns.length} campanha(s), sendo {campaigns.filter((item) => item.status === 'ACTIVE').length} ativa(s).</p></div></section>
  </div>;
}
