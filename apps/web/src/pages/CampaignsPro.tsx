import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarRange, ChevronRight, Filter, Layers3, Megaphone, MonitorSmartphone, Pause, Play, RefreshCw, Search, Target, UsersRound, X } from 'lucide-react';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type MetricRow = {
  id: string; name: string; status?: string | null; effectiveStatus?: string | null;
  spend: number; impressions: number; reach: number; clicks: number; inlineLinkClicks: number;
  leads: number; conversations: number; purchases: number; revenue: number; frequency: number;
  ctr: number; linkCtr: number; cpc: number; cpm: number; costPerLead: number; costPerConversation: number; costPerPurchase: number; roas: number;
  metaCampaignId?: string; metaAdsetId?: string; metaAdId?: string; objective?: string | null; optimizationGoal?: string | null; creativeId?: string | null;
  adSetCount?: number; adCount?: number;
  adAccount?: { id: string; accountId: string; name?: string | null; businessName?: string | null };
  campaign?: any; adSet?: any;
};
type BreakdownRow = { value: string; spend: number; impressions: number; reach: number; clicks: number; leads: number; conversations: number; purchases: number; revenue: number; ctr: number; cpc: number; cpm: number; cpl: number; cpa: number; roas: number };

const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v: unknown) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = (v: unknown) => Math.round(num(v)).toLocaleString('pt-BR');
const pct = (v: unknown) => `${num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const dec = (v: unknown) => num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const ago = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };

export default function CampaignsPro() {
  const user = useAuth((state) => state.user);
  const scope = useScope();
  const canManage = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const [tab, setTab] = useState<'campaigns' | 'adsets' | 'ads'>('campaigns');
  const [since, setSince] = useState(ago(29));
  const [until, setUntil] = useState(today());
  const [campaignId, setCampaignId] = useState('');
  const [adSetId, setAdSetId] = useState('');
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [campaignOptions, setCampaignOptions] = useState<MetricRow[]>([]);
  const [adSetOptions, setAdSetOptions] = useState<MetricRow[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('spend-desc');
  const [selected, setSelected] = useState<MetricRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [breakdownType, setBreakdownType] = useState<'age'|'gender'|'region'|'publisher_platform'|'device_platform'|'platform_position'>('age');
  const [breakdownRows, setBreakdownRows] = useState<BreakdownRow[]>([]);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const base = useMemo(() => ({
    clientId: scope.clientId,
    ...(scope.businessId ? { businessId: scope.businessId } : {}),
    ...(scope.adAccountId ? { adAccountId: scope.adAccountId } : {}),
    since, until,
  }), [scope.clientId, scope.businessId, scope.adAccountId, since, until]);

  async function loadOptions() {
    if (!scope.clientId) return;
    const campaignsResponse = await api.get('/performance/campaigns', { params: base });
    const campaigns = Array.isArray(campaignsResponse.data?.data) ? campaignsResponse.data.data : [];
    setCampaignOptions(campaigns);
    if (campaignId) {
      const adsetsResponse = await api.get('/performance/adsets', { params: { ...base, campaignId } });
      setAdSetOptions(Array.isArray(adsetsResponse.data?.data) ? adsetsResponse.data.data : []);
    } else setAdSetOptions([]);
  }

  async function load() {
    if (!scope.clientId) return;
    setLoading(true); setError('');
    try {
      await loadOptions();
      const endpoint = tab === 'campaigns' ? '/performance/campaigns' : tab === 'adsets' ? '/performance/adsets' : '/performance/ads';
      const response = await api.get(endpoint, { params: { ...base, ...(campaignId ? { campaignId } : {}), ...(adSetId ? { adSetId } : {}) } });
      setRows(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || 'Não foi possível carregar campanhas e anúncios.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tab, base.clientId, base.businessId, base.adAccountId, base.since, base.until, campaignId, adSetId]);
  useEffect(() => { if (!campaignId) setAdSetId(''); }, [campaignId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = rows.filter((row) => (!term || row.name.toLowerCase().includes(term)) && (!status || String(row.status || row.effectiveStatus || '') === status));
    return [...list].sort((a, b) => {
      if (sort === 'spend-asc') return num(a.spend) - num(b.spend);
      if (sort === 'leads-desc') return num(b.leads) - num(a.leads);
      if (sort === 'cpl-asc') return num(a.costPerLead || 999999) - num(b.costPerLead || 999999);
      if (sort === 'roas-desc') return num(b.roas) - num(a.roas);
      return num(b.spend) - num(a.spend);
    });
  }, [rows, search, status, sort]);

  async function changeCampaignStatus(row: MetricRow, next: 'ACTIVE'|'PAUSED') {
    if (!canManage) return;
    try {
      await api.post(`/campaigns/${row.id}/status`, { status: next });
      await load();
    } catch (requestError: any) { setError(requestError?.response?.data?.error?.message || 'Não foi possível alterar o status da campanha.'); }
  }

  async function syncBreakdowns() {
    if (!scope.clientId) return;
    setBreakdownLoading(true); setError('');
    try {
      await api.post('/performance/breakdowns/sync', { ...base, types: [breakdownType], level: tab === 'campaigns' ? 'campaign' : tab === 'adsets' ? 'adset' : 'ad' });
      await loadBreakdowns();
    } catch (requestError: any) { setError(requestError?.response?.data?.error?.message || 'Não foi possível sincronizar os detalhamentos.'); }
    finally { setBreakdownLoading(false); }
  }

  async function loadBreakdowns() {
    if (!scope.clientId) return;
    try {
      const response = await api.get('/performance/breakdowns', { params: { ...base, type: breakdownType, level: tab === 'campaigns' ? 'campaign' : tab === 'adsets' ? 'adset' : 'ad', ...(campaignId ? { campaignId } : {}), ...(adSetId ? { adSetId } : {}) } });
      setBreakdownRows(Array.isArray(response.data?.data?.rows) ? response.data.data.rows : []);
    } catch { setBreakdownRows([]); }
  }

  useEffect(() => { void loadBreakdowns(); }, [breakdownType, tab, base.clientId, base.businessId, base.adAccountId, base.since, base.until, campaignId, adSetId]);

  function preset(value: string) { const end = today(); setUntil(end); if (value === '7') setSince(ago(6)); if (value === '14') setSince(ago(13)); if (value === '30') setSince(ago(29)); if (value === '90') setSince(ago(89)); if (value === 'month') setSince(`${end.slice(0,8)}01`); if (value === 'year') setSince(`${end.slice(0,4)}-01-01`); }

  return <div className="space-y-4">
    <section className="page-heading"><div><p className="section-kicker">Gerenciador</p><h1>Campanhas e anúncios</h1><p>Navegue da campanha até o anúncio individual mantendo BM, conta e período fixos.</p></div><button className="secondary-button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Atualizar</button></section>

    <section className="filter-panel"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"><label className="field-label">Período<select className="field-control" defaultValue="30" onChange={(e) => preset(e.target.value)}><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="month">Mês</option><option value="year">Ano</option></select></label><label className="field-label"><span><CalendarRange size={12} /> Inicial</span><input className="field-control" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label><label className="field-label"><span><CalendarRange size={12} /> Final</span><input className="field-control" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label><label className="field-label">Campanha<select className="field-control" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}><option value="">Todas</option>{campaignOptions.map((row) => <option key={row.id} value={row.metaCampaignId}>{row.name}</option>)}</select></label><label className="field-label">Conjunto<select className="field-control" value={adSetId} disabled={!campaignId} onChange={(e) => setAdSetId(e.target.value)}><option value="">Todos</option>{adSetOptions.map((row) => <option key={row.id} value={row.metaAdsetId}>{row.name}</option>)}</select></label><label className="field-label">Status<select className="field-control" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option><option value="ACTIVE">Ativo</option><option value="PAUSED">Pausado</option></select></label><label className="field-label">Ordenar<select className="field-control" value={sort} onChange={(e) => setSort(e.target.value)}><option value="spend-desc">Maior investimento</option><option value="spend-asc">Menor investimento</option><option value="leads-desc">Mais leads</option><option value="cpl-asc">Menor CPL</option><option value="roas-desc">Maior ROAS</option></select></label></div><div className="mt-3 flex items-center gap-2"><Search size={13} className="text-slate-400" /><input className="field-control max-w-md" placeholder="Buscar pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} /></div></section>

    <div className="flex gap-1 border-b border-[#dde4df]">{([['campaigns','Campanhas',Megaphone],['adsets','Conjuntos',Layers3],['ads','Anúncios',MonitorSmartphone]] as const).map(([key,label,Icon]) => <button key={key} className={`tab-button ${tab === key ? 'tab-active' : ''}`} onClick={() => setTab(key)}><Icon size={14} />{label}</button>)}</div>
    {error && <div className="message-warning">{error}</div>}

    <section className="corporate-card overflow-hidden"><div className="table-scroll"><table className="corporate-table"><thead><tr><th>Nome</th><th>Status</th><th>Investimento</th><th>Alcance</th><th>Impressões</th><th>Freq.</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Leads</th><th>CPL</th><th>Conversas</th><th>Custo conv.</th><th>Compras</th><th>CPA</th><th>Receita</th><th>ROAS</th><th></th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><button className="text-left" onClick={() => setSelected(row)}><strong>{row.name}</strong><small>{row.objective || row.optimizationGoal || row.creativeId || ''}</small></button></td><td><span className={`status-chip ${String(row.status || row.effectiveStatus) === 'ACTIVE' ? 'status-success' : 'status-neutral'}`}>{row.status || row.effectiveStatus || '—'}</span></td><td>{money(row.spend)}</td><td>{integer(row.reach)}</td><td>{integer(row.impressions)}</td><td>{dec(row.frequency)}</td><td>{integer(row.clicks)}</td><td>{pct(row.ctr)}</td><td>{money(row.cpc)}</td><td>{money(row.cpm)}</td><td>{integer(row.leads)}</td><td>{money(row.costPerLead)}</td><td>{integer(row.conversations)}</td><td>{money(row.costPerConversation)}</td><td>{integer(row.purchases)}</td><td>{money(row.costPerPurchase)}</td><td>{money(row.revenue)}</td><td>{dec(row.roas)}x</td><td><button className="icon-button" onClick={() => setSelected(row)}><ChevronRight size={14} /></button></td></tr>)}{!filtered.length && <tr><td colSpan={19}><div className="empty-state"><Filter size={18} /><span>Nenhum item encontrado neste escopo.</span></div></td></tr>}</tbody></table></div></section>

    <section className="corporate-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="panel-title">Análise por público e posicionamento</h2><p className="panel-subtitle">Breakdowns reais da Meta para apoiar decisões de segmentação e criativo.</p></div><div className="flex flex-wrap gap-2"><select className="field-control w-auto" value={breakdownType} onChange={(e) => setBreakdownType(e.target.value as any)}><option value="age">Idade</option><option value="gender">Gênero</option><option value="region">Região</option><option value="publisher_platform">Plataforma</option><option value="device_platform">Dispositivo</option><option value="platform_position">Posicionamento</option></select><button className="secondary-button" disabled={breakdownLoading} onClick={() => { void syncBreakdowns(); }}><RefreshCw size={13} className={breakdownLoading ? 'animate-spin' : ''} />Sincronizar análise</button></div></div><div className="mt-4 table-scroll"><table className="corporate-table"><thead><tr><th>Dimensão</th><th>Investimento</th><th>Alcance</th><th>Impressões</th><th>CTR</th><th>CPC</th><th>Leads</th><th>CPL</th><th>Compras</th><th>ROAS</th></tr></thead><tbody>{breakdownRows.map((row) => <tr key={row.value}><td><strong>{row.value}</strong></td><td>{money(row.spend)}</td><td>{integer(row.reach)}</td><td>{integer(row.impressions)}</td><td>{pct(row.ctr)}</td><td>{money(row.cpc)}</td><td>{integer(row.leads)}</td><td>{money(row.cpl)}</td><td>{integer(row.purchases)}</td><td>{dec(row.roas)}x</td></tr>)}{!breakdownRows.length && <tr><td colSpan={10}><div className="empty-state"><UsersRound size={18} /><span>Sincronize esta dimensão para visualizar os dados.</span></div></td></tr>}</tbody></table></div></section>

    {selected && <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setSelected(null)}><aside className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between border-b border-[#e0e5e2] p-5"><div><p className="section-kicker">Detalhes</p><h2 className="mt-1 text-[18px] font-semibold">{selected.name}</h2></div><button className="icon-button" onClick={() => setSelected(null)}><X size={16} /></button></div><div className="space-y-4 p-5"><div className="grid grid-cols-2 gap-3">{[['Investimento',money(selected.spend)],['Alcance',integer(selected.reach)],['Impressões',integer(selected.impressions)],['Frequência',dec(selected.frequency)],['CTR',pct(selected.ctr)],['CPC',money(selected.cpc)],['CPM',money(selected.cpm)],['Leads',integer(selected.leads)],['CPL',money(selected.costPerLead)],['Conversas',integer(selected.conversations)],['Compras',integer(selected.purchases)],['ROAS',`${dec(selected.roas)}x`]].map(([label,value]) => <div key={label} className="rounded-[7px] border border-[#e1e6e3] p-3"><p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p><strong className="mt-1 block text-[13px]">{value}</strong></div>)}</div>{tab === 'campaigns' && canManage && <div className="border-t border-[#e1e6e3] pt-4"><p className="mb-2 text-[11px] font-semibold">Operação da campanha</p><div className="flex gap-2"><button className="secondary-button" onClick={() => { void changeCampaignStatus(selected,'ACTIVE'); }}><Play size={13} />Ativar</button><button className="secondary-button" onClick={() => { void changeCampaignStatus(selected,'PAUSED'); }}><Pause size={13} />Pausar</button></div></div>}<div className="rounded-[7px] bg-[#f6f8f6] p-3 text-[10px] text-slate-500"><Target size={13} className="mb-1 text-[#176846]" />Os valores exibidos respeitam o período, BM e conta selecionados no topo da plataforma.</div></div></aside></div>}
  </div>;
}
