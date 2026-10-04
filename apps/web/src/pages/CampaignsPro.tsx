import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarRange, ChevronRight, Circle, Filter, Layers3, Megaphone, MonitorSmartphone, Pause, Play, Plus, RefreshCw, Search, Target, UsersRound, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type MetricRow = {
  id: string; name: string; status?: string | null; effectiveStatus?: string | null; configuredStatus?: string | null;
  deliveryStatusKey?: string | null; deliveryStatusLabel?: string | null; deliverySeverity?: 'success'|'info'|'warning'|'danger'|'neutral'; deliveryReason?: string | null;
  spend: number; impressions: number; reach: number; clicks: number; inlineLinkClicks: number;
  leads: number; conversations: number; purchases: number; revenue: number; frequency: number;
  ctr: number; linkCtr: number; cpc: number; cpm: number; costPerLead: number; costPerConversation: number; costPerPurchase: number; roas: number;
  metaCampaignId?: string; metaAdsetId?: string; metaAdId?: string; objective?: string | null; optimizationGoal?: string | null; creativeId?: string | null;
  adSetCount?: number; adCount?: number;
  adAccount?: { id: string; accountId: string; name?: string | null; businessName?: string | null };
  campaign?: any; adSet?: any;
};
type BreakdownRow = { value: string; spend: number; impressions: number; reach: number; clicks: number; leads: number; conversations: number; purchases: number; revenue: number; ctr: number; cpc: number; cpm: number; cpl: number; cpa: number; roas: number };
type LiveCampaign = { metaCampaignId: string; configuredStatus?: string | null; effectiveStatus?: string | null; deliveryStatusKey?: string; deliveryStatusLabel?: string; severity?: MetricRow['deliverySeverity']; reason?: string | null; issues?: any[]; updatedAt?: string };

const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v: unknown) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const integer = (v: unknown) => Math.round(num(v)).toLocaleString('pt-BR');
const pct = (v: unknown) => `${num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const dec = (v: unknown) => num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const ago = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
const statusTranslation: Record<string,string> = { ACTIVE:'Ativa', PAUSED:'Pausada', ARCHIVED:'Arquivada', DELETED:'Excluída', IN_PROCESS:'Processando', WITH_ISSUES:'Com problemas', PENDING_REVIEW:'Em análise', DISAPPROVED:'Reprovada', PREAPPROVED:'Pré-aprovada', PENDING_BILLING_INFO:'Aguardando cobrança', CAMPAIGN_PAUSED:'Campanha pausada', ADSET_PAUSED:'Conjunto pausado', PAYMENT_ERROR:'Erro de pagamento', NO_BALANCE:'Sem saldo', PAYMENT_PROCESSING:'Pagamento em processamento', ACCOUNT_REVIEW:'Em análise da conta', GRACE_PERIOD:'Período de carência', ACCOUNT_DISABLED:'Conta desativada' };
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
function rowStatusKey(row: MetricRow) { return String(row.deliveryStatusKey || row.effectiveStatus || row.status || '').toUpperCase(); }
function rowStatusLabel(row: MetricRow) { const key = rowStatusKey(row); return row.deliveryStatusLabel || statusTranslation[key] || key || '—'; }
function statusClasses(row: MetricRow) {
  const severity = row.deliverySeverity;
  if (severity === 'danger') return 'border-red-200 bg-red-50 text-red-700';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (severity === 'info') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (severity === 'success' || rowStatusKey(row) === 'ACTIVE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export default function CampaignsPro() {
  const user = useAuth((state) => state.user);
  const scope = useScope();
  const scopeKey = JSON.stringify([scope.clientId, scope.businessId, scope.adAccountId]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const canManage = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const [tab, setTab] = useState<'campaigns' | 'adsets' | 'ads'>('campaigns');
  const [since, setSince] = useState(ago(29));
  const [until, setUntil] = useState(today());
  const [campaignFilter, setCampaignFilter] = useState({ scopeKey: '', campaignId: '', adSetId: '' });
  const campaignId = campaignFilter.scopeKey === scopeKey ? campaignFilter.campaignId : '';
  const adSetId = campaignFilter.scopeKey === scopeKey ? campaignFilter.adSetId : '';
  const setCampaignId = (value: string) => setCampaignFilter({ scopeKey, campaignId: value, adSetId: '' });
  const setAdSetId = (value: string) => setCampaignFilter({ scopeKey, campaignId, adSetId: value });
  const [storedRows, setRows] = useState<MetricRow[]>([]);
  const [dataContext, setDataContext] = useState('');
  const [storedCampaignOptions, setCampaignOptions] = useState<MetricRow[]>([]);
  const [storedAdSetOptions, setAdSetOptions] = useState<MetricRow[]>([]);
  const [search, setSearch] = useState(() => searchParams.get('busca') || '');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('spend-desc');
  const [selection, setSelection] = useState<{ scopeKey: string; row: MetricRow | null }>({ scopeKey: '', row: null });
  const selected = selection.scopeKey === scopeKey ? selection.row : null;
  const setSelected = (row: MetricRow | null) => setSelection({ scopeKey, row });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [breakdownType, setBreakdownType] = useState<'age'|'gender'|'region'|'publisher_platform'|'device_platform'|'platform_position'>('age');
  const [storedBreakdownRows, setBreakdownRows] = useState<BreakdownRow[]>([]);
  const [breakdownDataContext, setBreakdownDataContext] = useState('');
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('OUTCOME_LEADS');
  const [createClientId, setCreateClientId] = useState('');
  const [createBusinessId, setCreateBusinessId] = useState('');
  const [createAccountId, setCreateAccountId] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [specialCategory, setSpecialCategory] = useState('');

  useEffect(() => { setSearch(searchParams.get('busca') || ''); }, [searchParams]);

  const base = useMemo(() => ({
    clientId: scope.clientId,
    ...(scope.businessId ? { businessId: scope.businessId } : {}),
    ...(scope.adAccountId ? { adAccountId: scope.adAccountId } : {}),
    since, until,
  }), [scope.clientId, scope.businessId, scope.adAccountId, since, until]);
  const contextKey = JSON.stringify([base, tab, campaignId, adSetId]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  const rows = dataContext === contextKey ? storedRows : [];
  const campaignOptions = dataContext === contextKey ? storedCampaignOptions : [];
  const adSetOptions = dataContext === contextKey ? storedAdSetOptions : [];
  const breakdownContext = JSON.stringify([contextKey, breakdownType]);
  const currentBreakdownContext = useRef(breakdownContext);
  currentBreakdownContext.current = breakdownContext;
  const breakdownRows = breakdownDataContext === breakdownContext ? storedBreakdownRows : [];

  const createBusinesses = useMemo(
    () => scope.businesses.filter((item) => item.clientId === createClientId && item.status === 'active'),
    [scope.businesses, createClientId],
  );

  const createAccounts = useMemo(
    () => scope.accounts.filter((item) =>
      item.clientId === createClientId
      && item.businessId === createBusinessId
      && item.isAssigned
      && item.isActive
    ),
    [scope.accounts, createClientId, createBusinessId],
  );

  useEffect(() => {
    if (!showCreate) return;
    const initialClient = scope.clients.some((item) => item.id === createClientId)
      ? createClientId
      : scope.clientId || scope.clients[0]?.id || '';
    if (initialClient !== createClientId) setCreateClientId(initialClient);
  }, [showCreate, scope.clientId, scope.clients, createClientId]);

  useEffect(() => {
    const available = scope.businesses.filter((item) => item.clientId === createClientId && item.status === 'active');
    const preferred = available.some((item) => item.metaBusinessId === createBusinessId)
      ? createBusinessId
      : available.some((item) => item.metaBusinessId === scope.businessId)
        ? scope.businessId
        : available.length === 1
          ? available[0].metaBusinessId
          : '';
    if (preferred !== createBusinessId) setCreateBusinessId(preferred);
  }, [createClientId, scope.businesses, scope.businessId, createBusinessId]);

  useEffect(() => {
    const preferred = scope.adAccountId && createAccounts.some((item) => item.id === scope.adAccountId)
      ? scope.adAccountId
      : createAccounts.length === 1
        ? createAccounts[0].id
        : '';
    if (!createAccounts.some((item) => item.id === createAccountId)) setCreateAccountId(preferred);
  }, [createAccounts, createAccountId, scope.adAccountId]);

  useEffect(() => {
    if (!canManage || searchParams.get('nova') !== '1') return;
    setShowCreate(true);
    const next = new URLSearchParams(searchParams);
    next.delete('nova');
    setSearchParams(next, { replace: true });
  }, [canManage, searchParams, setSearchParams]);

  async function loadOptions() {
    if (!scope.clientId) return;
    const campaignsResponse = await api.get('/performance/campaigns', { params: base });
    if (currentContext.current !== contextKey) return [];
    const campaigns = Array.isArray(campaignsResponse.data?.data) ? campaignsResponse.data.data : [];
    setCampaignOptions(campaigns);
    if (campaignId) {
      const adsetsResponse = await api.get('/performance/adsets', { params: { ...base, campaignId } });
      if (currentContext.current !== contextKey) return [];
      setAdSetOptions(Array.isArray(adsetsResponse.data?.data) ? adsetsResponse.data.data : []);
    } else setAdSetOptions([]);
    return campaigns as MetricRow[];
  }

  async function load(forceLive = false) {
    if (!scope.clientId) return;
    setLoading(true); setError('');
    try {
      const campaigns = await loadOptions();
      if (currentContext.current !== contextKey) return;
      const endpoint = tab === 'campaigns' ? '/performance/campaigns' : tab === 'adsets' ? '/performance/adsets' : '/performance/ads';
      let result: MetricRow[];
      if (tab === 'campaigns') {
        result = (campaigns || []).filter((row) => !campaignId || row.metaCampaignId === campaignId);
      } else {
        const response = await api.get(endpoint, { params: { ...base, ...(campaignId ? { campaignId } : {}), ...(adSetId ? { adSetId } : {}) } });
        result = Array.isArray(response.data?.data) ? response.data.data : [];
      }
      if (tab === 'campaigns') {
        try {
          const liveResponse = await api.get('/meta/live/campaigns', { params: { clientId: scope.clientId, ...(scope.businessId ? { businessId: scope.businessId } : {}), ...(scope.adAccountId ? { adAccountId: scope.adAccountId } : {}), force: forceLive ? 'true' : 'false' } });
          const liveRows: LiveCampaign[] = Array.isArray(liveResponse.data?.data?.rows) ? liveResponse.data.data.rows : [];
          const map = new Map(liveRows.map((item) => [item.metaCampaignId,item]));
          result = result.map((row) => {
            const live = row.metaCampaignId ? map.get(row.metaCampaignId) : undefined;
            return live ? { ...row, configuredStatus: live.configuredStatus || row.status, effectiveStatus: live.effectiveStatus || row.effectiveStatus, deliveryStatusKey: live.deliveryStatusKey, deliveryStatusLabel: live.deliveryStatusLabel, deliverySeverity: live.severity, deliveryReason: live.reason || null } : row;
          });
        } catch { /* mantém o último status sincronizado se a Meta estiver temporariamente indisponível */ }
      }
      if (currentContext.current !== contextKey) return;
      setRows(result);
      setDataContext(contextKey);
    } catch (requestError: any) {
      if (currentContext.current !== contextKey) return;
      setError(requestError?.response?.data?.error?.message || 'Não foi possível carregar campanhas e anúncios.');
    } finally { if (currentContext.current === contextKey) setLoading(false); }
  }

  useEffect(() => { void load(false); }, [tab, base.clientId, base.businessId, base.adAccountId, base.since, base.until, campaignId, adSetId]);
  useEffect(() => {
    if (!scope.clientId || tab !== 'campaigns') return;
    const timer = window.setInterval(() => { void load(false); }, 60_000);
    return () => window.clearInterval(timer);
  }, [scope.clientId, scope.businessId, scope.adAccountId, tab, campaignId, adSetId, since, until]);
  useEffect(() => { if (!campaignId) setAdSetId(''); }, [campaignId]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = rows.filter((row) => (!term || row.name.toLowerCase().includes(term)) && (!status || rowStatusKey(row) === status));
    return [...list].sort((a, b) => {
      if (sort === 'spend-asc') return num(a.spend) - num(b.spend);
      if (sort === 'leads-desc') return num(b.leads) - num(a.leads);
      if (sort === 'cpl-asc') return num(a.costPerLead || 999999) - num(b.costPerLead || 999999);
      if (sort === 'roas-desc') return num(b.roas) - num(a.roas);
      return num(b.spend) - num(a.spend);
    });
  }, [rows, search, status, sort]);

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !createClientId || !createBusinessId || !createAccountId || !name.trim()) return;
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await api.post('/campaigns', {
        clientId: createClientId,
        businessId: createBusinessId,
        adAccountId: createAccountId,
        name: name.trim(),
        objective,
        ...(dailyBudget ? { dailyBudget: Number(dailyBudget.replace(',', '.')) } : {}),
        specialAdCategories: specialCategory ? [specialCategory] : [],
      });
      scope.setClientId(createClientId);
      scope.setBusinessId(createBusinessId);
      scope.setAdAccountId(createAccountId);
      setName('');
      setDailyBudget('');
      setSpecialCategory('');
      setShowCreate(false);
      setTab('campaigns');
      setCampaignId('');
      setAdSetId('');
      setNotice('Campanha criada diretamente na Meta em modo pausado. Revise a configuração antes de ativar.');
      await load(true);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || requestError?.response?.data?.message || 'A campanha não foi criada. Verifique a conta, a BM e as permissões da Meta.');
    } finally {
      setCreating(false);
    }
  }

  async function changeCampaignStatus(row: MetricRow, next: 'ACTIVE'|'PAUSED') {
    if (!canManage) return;
    try {
      await api.post(`/campaigns/${row.id}/status`, {
        status: next,
        clientId: scope.clientId,
        ...(scope.businessId ? { businessId: scope.businessId } : {}),
      });
      await load(true);
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
      if (currentBreakdownContext.current !== breakdownContext) return;
      setBreakdownRows(Array.isArray(response.data?.data?.rows) ? response.data.data.rows : []);
      setBreakdownDataContext(breakdownContext);
    } catch { if (currentBreakdownContext.current === breakdownContext) setBreakdownRows([]); }
  }

  useEffect(() => { void loadBreakdowns(); }, [breakdownType, tab, base.clientId, base.businessId, base.adAccountId, base.since, base.until, campaignId, adSetId]);

  function preset(value: string) { const end = today(); setUntil(end); if (value === '7') setSince(ago(6)); if (value === '14') setSince(ago(13)); if (value === '30') setSince(ago(29)); if (value === '90') setSince(ago(89)); if (value === 'month') setSince(`${end.slice(0,8)}01`); if (value === 'year') setSince(`${end.slice(0,4)}-01-01`); }

  return <div className="space-y-4">
    <section className="page-heading"><div><p className="section-kicker">Gerenciador</p><h1>Campanhas e anúncios</h1><p>Navegue da campanha até o anúncio individual mantendo BM, conta e período fixos. O status de campanha consulta a entrega atual da Meta e atualiza automaticamente a cada minuto.</p></div><div className="flex flex-wrap gap-2">{canManage && <button type="button" className="primary-button" onClick={() => setShowCreate((value) => !value)}><Plus size={14} />{showCreate ? 'Fechar criação' : 'Nova campanha'}</button>}<button className="secondary-button" onClick={() => { void load(true); }} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Atualizar agora</button></div></section>

    {showCreate && canManage && <form onSubmit={createCampaign} className="corporate-card p-4">
      <div className="mb-4 flex flex-col gap-1"><p className="section-kicker">Meta Ads</p><h2 className="panel-title">Criar nova campanha</h2><p className="panel-subtitle">Selecione Empresa → Business Manager → Conta, como no Gerenciador de Anúncios. A campanha será criada pausada para revisão.</p></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="field-label">Empresa<select required className="field-control" value={createClientId} onChange={(e) => { setCreateClientId(e.target.value); setCreateBusinessId(''); setCreateAccountId(''); }}><option value="">Selecione a empresa</option>{scope.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="field-label">Business Manager<select required className="field-control" value={createBusinessId} disabled={!createClientId || !createBusinesses.length} onChange={(e) => { setCreateBusinessId(e.target.value); setCreateAccountId(''); }}><option value="">{createBusinesses.length ? 'Selecione a BM' : 'Nenhuma BM vinculada'}</option>{createBusinesses.map((business) => <option key={business.id} value={business.metaBusinessId}>{business.name}</option>)}</select></label>
        <label className="field-label">Conta de anúncio<select required className="field-control" value={createAccountId} disabled={!createBusinessId || !createAccounts.length} onChange={(e) => setCreateAccountId(e.target.value)}><option value="">{createAccounts.length ? 'Selecione a conta' : 'Nenhuma conta autorizada'}</option>{createAccounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.accountId}{account.currency ? ` · ${account.currency}` : ''}</option>)}</select></label>

        {createClientId && !createBusinesses.length && <div className="message-warning md:col-span-2 xl:col-span-3 flex flex-wrap items-center justify-between gap-2"><span>Esta empresa ainda não possui BM vinculada. Associe a BM correta no cadastro da empresa.</span><button type="button" className="secondary-button" onClick={() => navigate('/empresas')}>Associar BM à empresa</button></div>}
        {createBusinessId && !createAccounts.length && <div className="message-warning md:col-span-2 xl:col-span-3">A BM selecionada ainda não possui conta de anúncios autorizada para esta empresa.</div>}

        <label className="field-label md:col-span-1 xl:col-span-2">Nome da campanha<input required minLength={3} maxLength={200} className="field-control" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Leads WhatsApp Joinville" /></label>
        <label className="field-label">Objetivo<select className="field-control" value={objective} onChange={(e) => setObjective(e.target.value)}>{objectives.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field-label">Orçamento diário<input className="field-control" inputMode="decimal" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} placeholder="Opcional" /><span className="mt-1 block text-[9px] font-normal text-slate-400">Valor na moeda da conta selecionada.</span></label>
        <label className="field-label">Categoria especial<select className="field-control" value={specialCategory} onChange={(e) => setSpecialCategory(e.target.value)}>{specialCategories.map(([value,label]) => <option key={value || 'none'} value={value}>{label}</option>)}</select></label>
        <div className="flex items-end justify-end md:col-span-2 xl:col-span-3"><button type="submit" className="primary-button" disabled={creating || !createClientId || !createBusinessId || !createAccountId}>{creating ? 'Criando na Meta...' : 'Criar campanha pausada'}</button></div>
      </div>
    </form>}

    {notice && <div className="rounded-[7px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700">{notice}</div>}

    <section className="filter-panel"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"><label className="field-label">Período<select className="field-control" defaultValue="30" onChange={(e) => preset(e.target.value)}><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option><option value="90">90 dias</option><option value="month">Mês</option><option value="year">Ano</option></select></label><label className="field-label"><span><CalendarRange size={12} /> Inicial</span><input className="field-control" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label><label className="field-label"><span><CalendarRange size={12} /> Final</span><input className="field-control" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label><label className="field-label">Campanha<select className="field-control" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}><option value="">Todas</option>{campaignOptions.map((row) => <option key={row.id} value={row.metaCampaignId}>{row.name}</option>)}</select></label><label className="field-label">Conjunto<select className="field-control" value={adSetId} disabled={!campaignId} onChange={(e) => setAdSetId(e.target.value)}><option value="">Todos</option>{adSetOptions.map((row) => <option key={row.id} value={row.metaAdsetId}>{row.name}</option>)}</select></label><label className="field-label">Status<select className="field-control" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option><option value="ACTIVE">Ativa</option><option value="PAUSED">Pausada</option><option value="PENDING_REVIEW">Em análise</option><option value="IN_PROCESS">Processando</option><option value="WITH_ISSUES">Com problemas</option><option value="PAYMENT_ERROR">Erro de pagamento</option><option value="NO_BALANCE">Sem saldo</option><option value="PAYMENT_PROCESSING">Pagamento em processamento</option><option value="ACCOUNT_REVIEW">Em análise da conta</option><option value="DISAPPROVED">Reprovada</option></select></label><label className="field-label">Ordenar<select className="field-control" value={sort} onChange={(e) => setSort(e.target.value)}><option value="spend-desc">Maior investimento</option><option value="spend-asc">Menor investimento</option><option value="leads-desc">Mais leads</option><option value="cpl-asc">Menor CPL</option><option value="roas-desc">Maior ROAS</option></select></label></div><div className="mt-3 flex flex-wrap items-center gap-2"><Search size={13} className="text-slate-400" /><input className="field-control max-w-md flex-1" placeholder="Buscar pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} />{tab==='campaigns'&&<button type="button" className={`secondary-button ${status==='ACTIVE'?'border-emerald-200 bg-emerald-50 text-emerald-700':''}`} onClick={()=>setStatus(current=>current==='ACTIVE'?'':'ACTIVE')}><Circle size={8} className="text-emerald-600" fill="currentColor"/>{status==='ACTIVE'?'Mostrando ativas':'Somente ativas'}</button>}</div></section>

    <div className="flex gap-1 border-b border-[#dde4df]">{([['campaigns','Campanhas',Megaphone],['adsets','Conjuntos',Layers3],['ads','Anúncios',MonitorSmartphone]] as const).map(([key,label,Icon]) => <button key={key} className={`tab-button ${tab === key ? 'tab-active' : ''}`} onClick={() => setTab(key)}><Icon size={14} />{label}</button>)}</div>
    {error && <div className="message-warning">{error}</div>}

    <section className="corporate-card overflow-hidden"><div className="table-scroll"><table className="corporate-table"><thead><tr><th>Nome</th><th>Status</th><th>Investimento</th><th>Alcance</th><th>Impressões</th><th>Freq.</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Leads</th><th>CPL</th><th>Conversas</th><th>Custo conv.</th><th>Compras</th><th>CPA</th><th>Receita</th><th>ROAS</th><th></th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><button className="text-left" onClick={() => setSelected(row)}><strong>{row.name}</strong><small>{row.objective || row.optimizationGoal || row.creativeId || ''}</small></button></td><td><span className={`status-chip ${statusClasses(row)}`}>{rowStatusKey(row)==='ACTIVE'&&<Circle size={7} className="text-emerald-600" fill="currentColor"/>}{row.deliverySeverity === 'danger' && <AlertTriangle size={12}/>} {rowStatusLabel(row)}</span>{row.deliveryReason && <small className="mt-1 block max-w-[220px] text-[9px] text-slate-500">{row.deliveryReason}</small>}</td><td>{money(row.spend)}</td><td>{integer(row.reach)}</td><td>{integer(row.impressions)}</td><td>{dec(row.frequency)}</td><td>{integer(row.clicks)}</td><td>{pct(row.ctr)}</td><td>{money(row.cpc)}</td><td>{money(row.cpm)}</td><td>{integer(row.leads)}</td><td>{money(row.costPerLead)}</td><td>{integer(row.conversations)}</td><td>{money(row.costPerConversation)}</td><td>{integer(row.purchases)}</td><td>{money(row.costPerPurchase)}</td><td>{money(row.revenue)}</td><td>{dec(row.roas)}x</td><td><button className="icon-button" onClick={() => setSelected(row)}><ChevronRight size={14} /></button></td></tr>)}{!filtered.length && <tr><td colSpan={19}><div className="empty-state"><Filter size={18} /><span>Nenhum item encontrado neste escopo.</span></div></td></tr>}</tbody></table></div></section>

    <section className="corporate-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="panel-title">Análise por público e posicionamento</h2><p className="panel-subtitle">Breakdowns reais da Meta para apoiar decisões de segmentação e criativo.</p></div><div className="flex flex-wrap gap-2"><select className="field-control w-auto" value={breakdownType} onChange={(e) => setBreakdownType(e.target.value as any)}><option value="age">Idade</option><option value="gender">Gênero</option><option value="region">Região</option><option value="publisher_platform">Plataforma</option><option value="device_platform">Dispositivo</option><option value="platform_position">Posicionamento</option></select><button className="secondary-button" disabled={breakdownLoading} onClick={() => { void syncBreakdowns(); }}><RefreshCw size={13} className={breakdownLoading ? 'animate-spin' : ''} />Sincronizar análise</button></div></div><div className="mt-4 table-scroll"><table className="corporate-table"><thead><tr><th>Dimensão</th><th>Investimento</th><th>Alcance</th><th>Impressões</th><th>CTR</th><th>CPC</th><th>Leads</th><th>CPL</th><th>Compras</th><th>ROAS</th></tr></thead><tbody>{breakdownRows.map((row) => <tr key={row.value}><td><strong>{row.value}</strong></td><td>{money(row.spend)}</td><td>{integer(row.reach)}</td><td>{integer(row.impressions)}</td><td>{pct(row.ctr)}</td><td>{money(row.cpc)}</td><td>{integer(row.leads)}</td><td>{money(row.cpl)}</td><td>{integer(row.purchases)}</td><td>{dec(row.roas)}x</td></tr>)}{!breakdownRows.length && <tr><td colSpan={10}><div className="empty-state"><UsersRound size={18} /><span>Sincronize esta dimensão para visualizar os dados.</span></div></td></tr>}</tbody></table></div></section>

    {selected && <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setSelected(null)}><aside className="h-full w-full max-w-md overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between border-b border-[#e0e5e2] p-5"><div><p className="section-kicker">Detalhes</p><h2 className="mt-1 text-[18px] font-semibold">{selected.name}</h2><div className="mt-2"><span className={`status-chip ${statusClasses(selected)}`}>{rowStatusKey(selected)==='ACTIVE'&&<Circle size={7} className="text-emerald-600" fill="currentColor"/>}{selected.deliverySeverity === 'danger' && <AlertTriangle size={12}/>} {rowStatusLabel(selected)}</span></div></div><button className="icon-button" onClick={() => setSelected(null)}><X size={16} /></button></div><div className="space-y-4 p-5">{selected.deliveryReason && <div className="rounded-[7px] border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800"><strong>Motivo informado pela Meta</strong><p className="mt-1">{selected.deliveryReason}</p></div>}<div className="grid grid-cols-2 gap-3">{[['Investimento',money(selected.spend)],['Alcance',integer(selected.reach)],['Impressões',integer(selected.impressions)],['Frequência',dec(selected.frequency)],['CTR',pct(selected.ctr)],['CPC',money(selected.cpc)],['CPM',money(selected.cpm)],['Leads',integer(selected.leads)],['CPL',money(selected.costPerLead)],['Conversas',integer(selected.conversations)],['Compras',integer(selected.purchases)],['ROAS',`${dec(selected.roas)}x`]].map(([label,value]) => <div key={label} className="rounded-[7px] border border-[#e1e6e3] p-3"><p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p><strong className="mt-1 block text-[13px]">{value}</strong></div>)}</div>{tab === 'campaigns' && canManage && <div className="border-t border-[#e1e6e3] pt-4"><p className="mb-2 text-[11px] font-semibold">Operação da campanha</p><div className="flex gap-2"><button className="secondary-button" onClick={() => { void changeCampaignStatus(selected,'ACTIVE'); }}><Play size={13} />Ativar</button><button className="secondary-button" onClick={() => { void changeCampaignStatus(selected,'PAUSED'); }}><Pause size={13} />Pausar</button></div></div>}<div className="rounded-[7px] bg-[#f6f8f6] p-3 text-[10px] text-slate-500"><Target size={13} className="mb-1 text-blue-600" />Os valores respeitam período, BM e conta. O status de entrega é consultado diretamente na Meta e pode refletir cobrança, saldo e revisão da conta.</div></div></aside></div>}
  </div>;
}
