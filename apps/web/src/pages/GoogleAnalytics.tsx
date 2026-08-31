import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Globe2,
  Link2,
  MonitorSmartphone,
  MousePointerClick,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Unplug,
  Users,
  WalletCards,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type Connection = {
  id: string;
  clientId: string;
  propertyId?: string | null;
  propertyName?: string | null;
  status: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
};

type Property = {
  propertyId: string;
  propertyName: string;
  accountName: string;
  accountId: string;
};

type Summary = {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  engagedSessions: number;
  engagementRate: number;
  keyEvents: number;
  totalRevenue: number;
  bounceRate?: number;
  averageSessionDuration?: number;
  screenPageViews?: number;
  screenPageViewsPerSession?: number;
  eventCount?: number;
  userEngagementDuration?: number;
  keyEventRate?: number;
  newUserRate?: number;
  revenuePerSession?: number;
};

type Report = {
  client: { id: string; name: string };
  property: { id: string; name?: string | null };
  defaultProperty?: { id?: string | null; name?: string | null };
  period: { since: string; until: string };
  previousPeriod?: { since: string; until: string };
  selectedSite?: string | null;
  summary: Summary;
  previousSummary?: Summary | null;
  realtime?: { available: boolean; activeUsers: number; warning?: string | null };
  ecommerce?: { purchases: number; transactions: number; purchaseRevenue: number; addToCarts: number; checkouts: number };
  sites?: Array<{ hostName: string; sessions: number; totalUsers: number; newUsers: number; keyEvents: number; totalRevenue: number }>;
  daily: Array<{ date: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  channels: Array<{ sessionDefaultChannelGroup: string; sessions: number; totalUsers: number; newUsers: number; engagedSessions: number; engagementRate: number; keyEvents: number; totalRevenue: number }>;
  sources?: Array<{ sessionSourceMedium: string; sessions: number; totalUsers: number; newUsers: number; engagedSessions: number; engagementRate: number; keyEvents: number; totalRevenue: number }>;
  userChannels?: Array<{ firstUserDefaultChannelGroup: string; totalUsers: number; newUsers: number; engagedSessions: number; keyEvents: number; totalRevenue: number }>;
  userSources?: Array<{ firstUserSourceMedium: string; totalUsers: number; newUsers: number; engagedSessions: number; keyEvents: number; totalRevenue: number }>;
  landingPages?: Array<{ landingPagePlusQueryString: string; sessions: number; totalUsers: number; newUsers: number; engagementRate: number; keyEvents: number; totalRevenue: number }>;
  pages?: Array<{ pagePathPlusQueryString: string; pageTitle: string; screenPageViews: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  devices?: Array<{ deviceCategory: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  browsers?: Array<{ browser: string; sessions: number; totalUsers: number; keyEvents: number }>;
  operatingSystems?: Array<{ operatingSystem: string; sessions: number; totalUsers: number; keyEvents: number }>;
  countries?: Array<{ country: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  cities?: Array<{ city: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  events?: Array<{ eventName: string; eventCount: number; keyEvents: number; totalRevenue: number }>;
  campaigns?: Array<{ sessionCampaignName: string; sessionSourceMedium: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  googleAds: { available: boolean; warning?: string | null; totals: any; campaigns: any[]; billing?: { available: boolean; reason?: string } };
  updatedAt: string;
};

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const number = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value || 0));
const decimal = (value: number, digits = 2) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value || 0));
const percent = (value: number, digits = 1) => `${decimal(Number(value || 0) * 100, digits)}%`;

const CHANNEL_PT: Record<string, string> = {
  Direct: 'Direto',
  'Organic Search': 'Pesquisa orgânica',
  'Paid Search': 'Pesquisa paga',
  Referral: 'Referência',
  'Organic Social': 'Social orgânico',
  'Paid Social': 'Social pago',
  Email: 'E-mail',
  Affiliates: 'Afiliados',
  Display: 'Display',
  'Organic Video': 'Vídeo orgânico',
  'Paid Video': 'Vídeo pago',
  'Organic Shopping': 'Shopping orgânico',
  'Paid Shopping': 'Shopping pago',
  Audio: 'Áudio',
  SMS: 'SMS',
  'Mobile Push Notifications': 'Notificações push',
  'Cross-network': 'Rede cruzada',
  Unassigned: 'Não atribuído',
  Other: 'Outros',
};

const EVENT_PT: Record<string, string> = {
  page_view: 'Visualização de página',
  session_start: 'Início de sessão',
  first_visit: 'Primeira visita',
  user_engagement: 'Engajamento do usuário',
  scroll: 'Rolagem de página',
  click: 'Clique',
  form_start: 'Início de formulário',
  form_submit: 'Envio de formulário',
  generate_lead: 'Geração de lead',
  purchase: 'Compra',
  add_to_cart: 'Adicionar ao carrinho',
  begin_checkout: 'Início do checkout',
  view_item: 'Visualização de item',
  view_item_list: 'Visualização de lista de itens',
  search: 'Pesquisa interna',
};

function periodDays(days: number) {
  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - Math.max(0, days - 1));
  return { since: iso(since), until: iso(until) };
}

function duration(seconds: number) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return minutes ? `${minutes} min ${remaining} s` : `${remaining} s`;
}

function formatGaDate(value: string) {
  if (value?.length === 8) return `${value.slice(6, 8)}/${value.slice(4, 6)}`;
  return value || '-';
}

function channelPt(value: string) {
  return CHANNEL_PT[value] || value || 'Não identificado';
}

function devicePt(value: string) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'mobile') return 'Celular';
  if (normalized === 'desktop') return 'Computador';
  if (normalized === 'tablet') return 'Tablet';
  if (normalized === 'smart tv') return 'TV inteligente';
  return value || 'Não identificado';
}

function sourceMediumPt(value: string) {
  return String(value || 'Não identificado')
    .replaceAll('(direct)', '(direto)')
    .replaceAll('(none)', '(nenhum)')
    .replace(/\boraganic\b/gi, 'orgânico')
    .replace(/\borganic\b/gi, 'orgânico')
    .replace(/\breferral\b/gi, 'referência')
    .replace(/\bpaid\b/gi, 'pago');
}

function changePercent(current: number, previous?: number | null) {
  const prev = Number(previous || 0);
  if (!prev) return null;
  return (Number(current || 0) - prev) / Math.abs(prev);
}

function Trend({ current, previous, inverse = false }: { current: number; previous?: number | null; inverse?: boolean }) {
  const delta = changePercent(current, previous);
  if (delta === null) return <span>sem base anterior</span>;
  const positive = inverse ? delta <= 0 : delta >= 0;
  const Icon = delta >= 0 ? TrendingUp : TrendingDown;
  return <span className={`inline-flex items-center gap-1 ${positive ? 'text-emerald-700' : 'text-amber-700'}`}><Icon size={11}/>{decimal(Math.abs(delta) * 100, 1)}% vs. período anterior</span>;
}

function KpiCard({ label, value, detail, trend, icon }: { label: string; value: string; detail: ReactNode; trend?: ReactNode; icon?: ReactNode }) {
  return <div className="mini-stat min-h-[112px]">
    <div className="flex items-center justify-between gap-2"><span>{label}</span>{icon && <span className="text-slate-400">{icon}</span>}</div>
    <strong>{value}</strong><small>{detail}</small>{trend && <small>{trend}</small>}
  </div>;
}

function EmptyRows({ colSpan, text = 'Sem dados no período.' }: { colSpan: number; text?: string }) {
  return <tr><td colSpan={colSpan}>{text}</td></tr>;
}

export default function GoogleAnalytics() {
  const user = useAuth((s) => s.user);
  const scope = useScope();
  const canAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');
  const initial = periodDays(30);
  const [since, setSince] = useState(initial.since);
  const [until, setUntil] = useState(initial.until);
  const [configured, setConfigured] = useState(true);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoaded, setPropertiesLoaded] = useState(false);
  const [propertiesCheckedAt, setPropertiesCheckedAt] = useState<string | null>(null);
  const [analysisPropertyId, setAnalysisPropertyId] = useState('');
  const [site, setSite] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');

  const clientId = scope.clientId || ((user?.role === 'CLIENT' || user?.role === 'MANAGER') ? user?.clientId || '' : '');
  const clientName = useMemo(() => scope.clients.find((c) => c.id === clientId)?.name || report?.client?.name || 'Empresa selecionada', [scope.clients, clientId, report]);

  async function fetchStatus(): Promise<Connection | null> {
    if (!clientId) { setConnection(null); setReport(null); return null; }
    const response = await api.get('/google-analytics/status', { params: { clientId } });
    setConfigured(Boolean(response.data?.data?.configured));
    const rows = Array.isArray(response.data?.data?.rows) ? response.data.data.rows : [];
    const current = rows.find((row: Connection) => row.clientId === clientId) || null;
    setConnection(current);
    setAnalysisPropertyId((selected) => selected || current?.propertyId || '');
    return current;
  }

  async function fetchProperties(): Promise<Property[]> {
    if (!canAdmin || !clientId) return [];
    const response = await api.get('/google-analytics/properties', { params: { clientId } });
    const rows: Property[] = Array.isArray(response.data?.data) ? response.data.data : [];
    setProperties(rows);
    setPropertiesLoaded(true);
    setPropertiesCheckedAt(new Date().toISOString());
    return rows;
  }

  async function fetchReport(current: Connection, selectedPropertyId?: string, selectedSite?: string) {
    const effectivePropertyId = selectedPropertyId || analysisPropertyId || current.propertyId || '';
    if (!clientId || current.status !== 'active' || !effectivePropertyId) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/google-analytics/decision-report', {
        params: {
          clientId,
          since,
          until,
          propertyId: effectivePropertyId,
          ...(selectedSite || site ? { site: selectedSite ?? site } : {}),
        },
      });
      setReport(response.data?.data || null);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || 'Não foi possível consultar os dados completos desta propriedade.');
    } finally {
      setLoading(false);
    }
  }

  async function syncGoogleState(withReport = true) {
    if (!clientId) return;
    setVerifying(true); setError('');
    try {
      let current = await fetchStatus();
      let availableProperties: Property[] = [];
      if (current?.status === 'active' && canAdmin) {
        availableProperties = await fetchProperties();
        if (current.propertyId && !availableProperties.some((item) => item.propertyId === current?.propertyId)) {
          setReport(null);
          setError('A propriedade GA4 definida como padrão não está mais acessível pela conta Google conectada. Selecione outra propriedade disponível.');
        }
        if (!current.propertyId && availableProperties.length === 1) {
          const onlyProperty = availableProperties[0];
          await api.patch('/google-analytics/property', { clientId, propertyId: onlyProperty.propertyId });
          current = await fetchStatus();
        }
      }
      const effectivePropertyId = analysisPropertyId || current?.propertyId || availableProperties[0]?.propertyId || '';
      if (effectivePropertyId && !analysisPropertyId) setAnalysisPropertyId(effectivePropertyId);
      if (withReport && current?.status === 'active' && effectivePropertyId) await fetchReport(current, effectivePropertyId, site);
    } catch (requestError: any) {
      if (requestError?.response?.status === 409) { setProperties([]); setPropertiesLoaded(true); }
      else setError(requestError?.response?.data?.error?.message || 'Não foi possível verificar automaticamente o Google Analytics.');
    } finally { setVerifying(false); }
  }

  useEffect(() => {
    setReport(null); setProperties([]); setPropertiesLoaded(false); setPropertiesCheckedAt(null); setError(''); setAnalysisPropertyId(''); setSite('');
    if (clientId) void syncGoogleState(true);
    else setConnection(null);
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    const timer = window.setInterval(() => { void syncGoogleState(true); }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [clientId, since, until, canAdmin, analysisPropertyId, site]);

  async function connect() {
    if (!clientId) return;
    setAction('connect'); setError('');
    const popup = window.open('about:blank', 'gestao-ads-google-analytics-oauth', 'width=760,height=860');
    try {
      const response = await api.get('/google-analytics/oauth/start', { params: { clientId } });
      const url = response.data?.data?.authUrl;
      if (!url) throw new Error('URL OAuth ausente');
      if (popup) popup.location.href = url; else window.location.assign(url);
      const timer = window.setInterval(async () => {
        if (popup?.closed) { window.clearInterval(timer); setAction(''); await syncGoogleState(true); }
      }, 1000);
    } catch (requestError: any) {
      popup?.close(); setAction('');
      setError(requestError?.response?.data?.error?.message || 'Não foi possível iniciar a conexão com o Google Analytics.');
    }
  }

  async function saveProperty() {
    if (!clientId || !analysisPropertyId) return;
    setAction('property'); setError('');
    try {
      if (propertiesLoaded && !properties.some((item) => item.propertyId === analysisPropertyId)) throw new Error('Esta propriedade não está disponível para a conta Google conectada.');
      await api.patch('/google-analytics/property', { clientId, propertyId: analysisPropertyId });
      await syncGoogleState(true);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || requestError?.message || 'Não foi possível definir a propriedade padrão.');
    } finally { setAction(''); }
  }

  async function disconnect() {
    if (!clientId || !window.confirm('Desconectar o Google Analytics desta empresa? A propriedade selecionada e a auditoria serão preservadas.')) return;
    setAction('disconnect');
    try {
      await api.post('/google-analytics/disconnect', { clientId });
      setReport(null); setProperties([]); setPropertiesLoaded(false); setAnalysisPropertyId(''); setSite('');
      await fetchStatus();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || 'Não foi possível desconectar o Google Analytics.');
    } finally { setAction(''); }
  }

  function applyPeriod(days: number) {
    const period = periodDays(days); setSince(period.since); setUntil(period.until);
  }

  const ads = report?.googleAds;
  const adsTotals = ads?.totals || {};
  const effectivePropertyId = analysisPropertyId || connection?.propertyId || '';
  const propertyStillAccessible = !canAdmin || !effectivePropertyId || !propertiesLoaded || properties.some((item) => item.propertyId === effectivePropertyId);
  const sites = report?.sites || [];

  const dailyChart = useMemo(() => (report?.daily || []).map((row) => ({ ...row, label: formatGaDate(row.date) })), [report]);
  const channelChart = useMemo(() => (report?.channels || []).slice(0, 8).map((row) => ({ name: channelPt(row.sessionDefaultChannelGroup), sessions: row.sessions, keyEvents: row.keyEvents })), [report]);

  const insights = useMemo(() => {
    if (!report) return [];
    const rows: Array<{ title: string; text: string; tone: 'good' | 'attention' | 'neutral' }> = [];
    const topChannel = report.channels?.[0];
    const topDevice = report.devices?.[0];
    const summary = report.summary;
    if (topChannel) {
      const share = summary.sessions ? topChannel.sessions / summary.sessions : 0;
      rows.push({ title: 'Principal canal de aquisição', text: `${channelPt(topChannel.sessionDefaultChannelGroup)} concentra ${percent(share)} das sessões e gerou ${number(topChannel.keyEvents)} eventos principais no período.`, tone: 'neutral' });
    }
    if (summary.engagementRate || summary.bounceRate) {
      const good = summary.engagementRate >= 0.6;
      rows.push({ title: 'Qualidade do tráfego', text: `Engajamento em ${percent(summary.engagementRate)} e rejeição em ${percent(summary.bounceRate || 0)}. ${good ? 'O nível de engajamento está saudável para aprofundar os canais que mais convertem.' : 'Revise páginas de entrada, promessa do anúncio, velocidade e clareza da experiência.'}`, tone: good ? 'good' : 'attention' });
    }
    if (topDevice) {
      const share = summary.sessions ? topDevice.sessions / summary.sessions : 0;
      rows.push({ title: 'Experiência por dispositivo', text: `${devicePt(topDevice.deviceCategory)} representa ${percent(share)} das sessões. Priorize testes e otimizações nessa experiência.`, tone: 'neutral' });
    }
    if (ads?.available && Number(adsTotals.cost || 0) > 0) {
      const roas = Number(adsTotals.roas || 0);
      rows.push({ title: 'Eficiência Google Ads', text: `Investimento de ${money(adsTotals.cost)} com ROAS de ${decimal(roas)}x e custo por evento principal de ${money(adsTotals.costPerKeyEvent || 0)}. ${roas >= 2 ? 'Há sinal positivo de retorno; valide margem e qualidade das conversões antes de escalar.' : 'O retorno atribuído pede revisão de campanhas, termos, páginas e eventos principais.'}`, tone: roas >= 2 ? 'good' : 'attention' });
    }
    return rows.slice(0, 4);
  }, [report, ads?.available, adsTotals.cost, adsTotals.roas, adsTotals.costPerKeyEvent]);

  return <div className="space-y-4">
    <section className="page-heading">
      <div><p className="section-kicker">Mensuração</p><h1>Google Analytics e Google Ads</h1><p>Painel completo em português do Brasil, separado por propriedade e site, com aquisição, comportamento, tecnologia, comércio eletrônico, conversão e mídia paga.</p></div>
      <button className="secondary-button" disabled={loading || verifying || !clientId} onClick={() => { void syncGoogleState(true); }}><RefreshCw size={14} className={(loading || verifying) ? 'animate-spin' : ''}/>{verifying ? 'Verificando...' : 'Atualizar dados'}</button>
    </section>

    {!clientId && <div className="message-warning">Selecione uma empresa no filtro superior para consultar o Google Analytics.</div>}
    {error && <div className="message-warning">{error}</div>}

    {clientId && <section className="corporate-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="panel-title">{clientName}</h2><p className="panel-subtitle">Integração individual por empresa · nenhuma credencial é exibida ou alterada nesta tela.</p></div><span className={`status-chip ${connection?.status === 'active' ? 'status-success' : 'status-neutral'}`}>{connection?.status === 'active' ? <CheckCircle2 size={12}/> : <Unplug size={12}/>} {connection?.status === 'active' ? 'Google conectado' : 'Google desconectado'}</span></div>
      {!configured && canAdmin && <div className="message-warning mt-3">O módulo está instalado, mas o OAuth do Google precisa estar configurado no ambiente de produção.</div>}

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.3fr_1fr_auto]">
        {canAdmin && <>
          <div><label className="field-label">Propriedade para análise</label><select className="field-control w-full" value={analysisPropertyId} onChange={(e) => { const next = e.target.value; setAnalysisPropertyId(next); setSite(''); if (connection?.status === 'active' && next) void fetchReport(connection, next, ''); }} disabled={connection?.status !== 'active' || verifying}><option value="">{connection?.status !== 'active' ? 'Conecte a conta Google primeiro' : !propertiesLoaded ? 'Verificando propriedades...' : properties.length ? 'Selecione a propriedade' : 'Nenhuma propriedade GA4 disponível'}</option>{properties.map((property) => <option key={property.propertyId} value={property.propertyId}>{property.accountName} · {property.propertyName} ({property.propertyId})</option>)}</select><p className="mt-1 text-[10px] leading-4 text-slate-500">Você pode analisar qualquer propriedade acessível sem substituir a propriedade padrão. {connection?.propertyId && <>Padrão atual: <strong>{connection.propertyName || connection.propertyId}</strong>.</>}</p></div>
          <div className="flex items-end"><button className="secondary-button" disabled={!analysisPropertyId || action === 'property' || analysisPropertyId === connection?.propertyId || verifying} onClick={() => { void saveProperty(); }}>Definir como propriedade padrão</button></div>
        </>}
        <div className="flex items-end gap-2">{canAdmin && <button className="primary-button" disabled={!configured || action === 'connect'} onClick={() => { void connect(); }}><Link2 size={13}/>{connection?.status === 'active' ? 'Reconectar Google' : 'Conectar Google'}</button>}{canAdmin && connection?.status === 'active' && <button className="secondary-button text-red-600" disabled={action === 'disconnect'} onClick={() => { void disconnect(); }}><Unplug size={13}/>Desconectar</button>}</div>
      </div>
      {propertiesCheckedAt && <p className="mt-2 text-[9px] text-slate-400">Propriedades verificadas em {new Date(propertiesCheckedAt).toLocaleString('pt-BR')} · atualização automática a cada 5 minutos.</p>}
    </section>}

    {clientId && connection?.status === 'active' && effectivePropertyId && propertyStillAccessible && <section className="filter-panel">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="field-label">De</label><input className="field-control" type="date" value={since} onChange={(e) => setSince(e.target.value)}/></div>
        <div><label className="field-label">Até</label><input className="field-control" type="date" value={until} onChange={(e) => setUntil(e.target.value)}/></div>
        <div><label className="field-label">Site</label><select className="field-control min-w-[220px]" value={site} onChange={(e) => { const next = e.target.value; setSite(next); if (connection) void fetchReport(connection, effectivePropertyId, next); }}><option value="">Todos os sites da propriedade</option>{sites.filter((item) => item.hostName && item.hostName !== '(not set)').map((item) => <option key={item.hostName} value={item.hostName}>{item.hostName}</option>)}</select></div>
        <div className="flex gap-1">{[7, 30, 90].map((days) => <button key={days} className="secondary-button" onClick={() => applyPeriod(days)}>{days} dias</button>)}</div>
        <button className="primary-button" disabled={loading || verifying} onClick={() => { if (connection) void fetchReport(connection, effectivePropertyId, site); }}><RefreshCw size={13} className={(loading || verifying) ? 'animate-spin' : ''}/>Aplicar filtros</button>
      </div>
    </section>}

    {report && <>
      <section className="corporate-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="section-kicker">Escopo analisado</p><h2 className="panel-title">{report.property.name || `Propriedade ${report.property.id}`}</h2><p className="panel-subtitle">{report.selectedSite ? `Site: ${report.selectedSite}` : 'Todos os sites desta propriedade'} · ID {report.property.id}</p></div>{report.realtime?.available && <span className="status-chip status-success"><Activity size={11}/>{number(report.realtime.activeUsers)} usuários ativos agora</span>}</div>
        {report.realtime?.warning && <p className="mt-2 text-[9px] text-slate-500">{report.realtime.warning}</p>}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Sessões" value={number(report.summary.sessions)} detail="Visitas no período" trend={<Trend current={report.summary.sessions} previous={report.previousSummary?.sessions}/>} icon={<Activity size={15}/>}/>
        <KpiCard label="Usuários" value={number(report.summary.totalUsers)} detail={`${number(report.summary.newUsers)} novos · ${percent(report.summary.newUserRate || 0)} do total`} trend={<Trend current={report.summary.totalUsers} previous={report.previousSummary?.totalUsers}/>} icon={<Users size={15}/>}/>
        <KpiCard label="Engajamento" value={percent(report.summary.engagementRate)} detail={`${number(report.summary.engagedSessions)} sessões engajadas · rejeição ${percent(report.summary.bounceRate || 0)}`} trend={<Trend current={report.summary.engagementRate} previous={report.previousSummary?.engagementRate}/>} icon={<Gauge size={15}/>}/>
        <KpiCard label="Eventos principais" value={number(report.summary.keyEvents)} detail={`${percent(report.summary.keyEventRate || 0)} por sessão`} trend={<Trend current={report.summary.keyEvents} previous={report.previousSummary?.keyEvents}/>} icon={<MousePointerClick size={15}/>}/>
        <KpiCard label="Visualizações" value={number(report.summary.screenPageViews || 0)} detail={`${decimal(report.summary.screenPageViewsPerSession || 0)} páginas/telas por sessão`} icon={<BarChart3 size={15}/>}/>
        <KpiCard label="Duração média" value={duration(report.summary.averageSessionDuration || 0)} detail={`${number(report.summary.eventCount || 0)} eventos registrados`} icon={<Activity size={15}/>}/>
        <KpiCard label="Receita" value={money(report.summary.totalRevenue)} detail={`${money(report.summary.revenuePerSession || 0)} por sessão`} trend={<Trend current={report.summary.totalRevenue} previous={report.previousSummary?.totalRevenue}/>} icon={<TrendingUp size={15}/>}/>
        <KpiCard label="Usuários ativos agora" value={report.realtime?.available ? number(report.realtime.activeUsers) : '—'} detail="Tempo real da propriedade" icon={<Activity size={15}/>}/>
      </section>

      <section className="corporate-card p-4">
        <div><p className="section-kicker">Sites da propriedade</p><h2 className="panel-title">Desempenho separado por site</h2><p className="panel-subtitle">Use o filtro acima para transformar todo o painel em uma visão exclusiva de um domínio.</p></div>
        <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Site</th><th>Sessões</th><th>Usuários</th><th>Novos</th><th>Eventos principais</th><th>Receita</th></tr></thead><tbody>{sites.map((row, index) => <tr key={`${row.hostName}-${index}`}><td><strong>{row.hostName || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.totalUsers)}</td><td>{number(row.newUsers)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}{!sites.length && <EmptyRows colSpan={6}/>}</tbody></table></div>
      </section>

      <section className="corporate-card p-4">
        <div><p className="section-kicker">Leitura executiva</p><h2 className="panel-title">Indicadores para tomada de decisão</h2><p className="panel-subtitle">Sinais calculados somente a partir dos dados retornados pelo GA4.</p></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{insights.map((item) => <article key={item.title} className={`rounded-[8px] border p-3 ${item.tone === 'good' ? 'border-emerald-200 bg-emerald-50/40' : item.tone === 'attention' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}><strong className="text-xs text-slate-800">{item.title}</strong><p className="mt-2 text-[11px] leading-5 text-slate-600">{item.text}</p></article>)}</div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4"><div><p className="section-kicker">Tendência</p><h2 className="panel-title">Evolução diária</h2><p className="panel-subtitle">Sessões e usuários ao longo do período selecionado.</p></div><div className="mt-4 h-[300px] min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={dailyChart} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24}/><YAxis tick={{ fontSize: 10 }}/><Tooltip formatter={(value: any) => number(Number(value || 0))}/><Legend wrapperStyle={{ fontSize: 11 }}/><Line type="monotone" dataKey="sessions" name="Sessões" stroke="#2563eb" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="totalUsers" name="Usuários" stroke="#0f766e" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></article>
        <article className="corporate-card p-4"><div><p className="section-kicker">Aquisição</p><h2 className="panel-title">Sessões por canal</h2><p className="panel-subtitle">Compare volume de tráfego e eventos principais por canal.</p></div><div className="mt-4 h-[300px] min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={channelChart} layout="vertical" margin={{ top: 8, right: 12, left: 20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" tick={{ fontSize: 10 }}/><YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 10 }}/><Tooltip formatter={(value: any) => number(Number(value || 0))}/><Legend wrapperStyle={{ fontSize: 11 }}/><Bar dataKey="sessions" name="Sessões" fill="#2563eb" radius={[0, 4, 4, 0]}/><Bar dataKey="keyEvents" name="Eventos principais" fill="#0f766e" radius={[0, 4, 4, 0]}/></BarChart></ResponsiveContainer></div></article>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4"><h2 className="panel-title">Aquisição de tráfego</h2><p className="panel-subtitle">Como as sessões chegaram ao site.</p><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Canal</th><th>Sessões</th><th>Usuários</th><th>Engajamento</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>{report.channels.map((row, index) => <tr key={`${row.sessionDefaultChannelGroup}-${index}`}><td><strong>{channelPt(row.sessionDefaultChannelGroup)}</strong></td><td>{number(row.sessions)}</td><td>{number(row.totalUsers)}</td><td>{percent(row.engagementRate)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}{!report.channels.length && <EmptyRows colSpan={6}/>}</tbody></table></div></article>
        <article className="corporate-card p-4"><h2 className="panel-title">Origem e mídia das sessões</h2><p className="panel-subtitle">Fontes responsáveis pelo tráfego atual.</p><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Origem / mídia</th><th>Sessões</th><th>Usuários</th><th>Engajamento</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>{(report.sources || []).slice(0, 20).map((row, index) => <tr key={`${row.sessionSourceMedium}-${index}`}><td><strong>{sourceMediumPt(row.sessionSourceMedium)}</strong></td><td>{number(row.sessions)}</td><td>{number(row.totalUsers)}</td><td>{percent(row.engagementRate)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}{!(report.sources || []).length && <EmptyRows colSpan={6}/>}</tbody></table></div></article>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4"><h2 className="panel-title">Aquisição de usuários</h2><p className="panel-subtitle">Primeiro canal pelo qual cada usuário foi adquirido.</p><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Primeiro canal</th><th>Usuários</th><th>Novos</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>{(report.userChannels || []).slice(0, 20).map((row, index) => <tr key={`${row.firstUserDefaultChannelGroup}-${index}`}><td><strong>{channelPt(row.firstUserDefaultChannelGroup)}</strong></td><td>{number(row.totalUsers)}</td><td>{number(row.newUsers)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}{!(report.userChannels || []).length && <EmptyRows colSpan={5}/>}</tbody></table></div></article>
        <article className="corporate-card p-4"><h2 className="panel-title">Primeira origem e mídia</h2><p className="panel-subtitle">Origem que trouxe o usuário pela primeira vez.</p><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Primeira origem / mídia</th><th>Usuários</th><th>Novos</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>{(report.userSources || []).slice(0, 20).map((row, index) => <tr key={`${row.firstUserSourceMedium}-${index}`}><td><strong>{sourceMediumPt(row.firstUserSourceMedium)}</strong></td><td>{number(row.totalUsers)}</td><td>{number(row.newUsers)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}{!(report.userSources || []).length && <EmptyRows colSpan={5}/>}</tbody></table></div></article>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4"><h2 className="panel-title">Páginas de entrada</h2><p className="panel-subtitle">Páginas que iniciaram as sessões.</p><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Página de entrada</th><th>Sessões</th><th>Engajamento</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>{(report.landingPages || []).slice(0, 20).map((row, index) => <tr key={`${row.landingPagePlusQueryString}-${index}`}><td><strong>{row.landingPagePlusQueryString || '(não definido)'}</strong></td><td>{number(row.sessions)}</td><td>{percent(row.engagementRate)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}{!(report.landingPages || []).length && <EmptyRows colSpan={5}/>}</tbody></table></div></article>
        <article className="corporate-card p-4"><h2 className="panel-title">Páginas mais acessadas</h2><p className="panel-subtitle">Conteúdos com maior volume de visualizações.</p><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Página</th><th>Título</th><th>Visualizações</th><th>Usuários</th><th>Eventos</th></tr></thead><tbody>{(report.pages || []).slice(0, 20).map((row, index) => <tr key={`${row.pagePathPlusQueryString}-${index}`}><td><strong>{row.pagePathPlusQueryString || '(não definido)'}</strong></td><td>{row.pageTitle || 'Sem título'}</td><td>{number(row.screenPageViews)}</td><td>{number(row.totalUsers)}</td><td>{number(row.keyEvents)}</td></tr>)}{!(report.pages || []).length && <EmptyRows colSpan={5}/>}</tbody></table></div></article>
      </section>

      <section className="grid gap-3 xl:grid-cols-4">
        <article className="corporate-card p-4"><div className="flex items-center gap-2"><MonitorSmartphone size={14}/><h2 className="panel-title">Dispositivos</h2></div><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Dispositivo</th><th>Sessões</th><th>Eventos</th></tr></thead><tbody>{(report.devices || []).map((row, index) => <tr key={`${row.deviceCategory}-${index}`}><td><strong>{devicePt(row.deviceCategory)}</strong></td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td></tr>)}{!(report.devices || []).length && <EmptyRows colSpan={3}/>}</tbody></table></div></article>
        <article className="corporate-card p-4"><h2 className="panel-title">Navegadores</h2><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Navegador</th><th>Sessões</th><th>Eventos</th></tr></thead><tbody>{(report.browsers || []).slice(0, 10).map((row, index) => <tr key={`${row.browser}-${index}`}><td><strong>{row.browser || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td></tr>)}{!(report.browsers || []).length && <EmptyRows colSpan={3}/>}</tbody></table></div></article>
        <article className="corporate-card p-4"><h2 className="panel-title">Sistemas operacionais</h2><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Sistema</th><th>Sessões</th><th>Eventos</th></tr></thead><tbody>{(report.operatingSystems || []).slice(0, 10).map((row, index) => <tr key={`${row.operatingSystem}-${index}`}><td><strong>{row.operatingSystem || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td></tr>)}{!(report.operatingSystems || []).length && <EmptyRows colSpan={3}/>}</tbody></table></div></article>
        <article className="corporate-card p-4"><div className="flex items-center gap-2"><Globe2 size={14}/><h2 className="panel-title">Localização</h2></div><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Local</th><th>Sessões</th><th>Eventos</th></tr></thead><tbody>{(report.cities || []).slice(0, 10).map((row, index) => <tr key={`${row.city}-${index}`}><td><strong>{row.city || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td></tr>)}{!(report.cities || []).length && <EmptyRows colSpan={3}/>}</tbody></table></div></article>
      </section>

      <section className="corporate-card p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="section-kicker">Comércio eletrônico</p><h2 className="panel-title">Funil de compras</h2><p className="panel-subtitle">Métricas exibidas quando o site envia eventos de comércio eletrônico compatíveis ao GA4.</p></div><ShoppingCart size={18} className="text-[#2563eb]"/></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div className="mini-stat"><span>Adicionar ao carrinho</span><strong>{number(report.ecommerce?.addToCarts || 0)}</strong><small>eventos</small></div><div className="mini-stat"><span>Inícios de checkout</span><strong>{number(report.ecommerce?.checkouts || 0)}</strong><small>eventos</small></div><div className="mini-stat"><span>Compras</span><strong>{number(report.ecommerce?.purchases || 0)}</strong><small>compras no GA4</small></div><div className="mini-stat"><span>Transações</span><strong>{number(report.ecommerce?.transactions || 0)}</strong><small>transações</small></div><div className="mini-stat"><span>Receita de compras</span><strong>{money(report.ecommerce?.purchaseRevenue || 0)}</strong><small>receita de comércio eletrônico</small></div></div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4"><h2 className="panel-title">Eventos</h2><p className="panel-subtitle">O nome técnico é mantido para não alterar a identificação configurada no GA4; quando conhecido, a descrição aparece em português.</p><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Evento</th><th>Descrição</th><th>Contagem</th><th>Principais</th><th>Receita</th></tr></thead><tbody>{(report.events || []).slice(0, 20).map((row, index) => <tr key={`${row.eventName}-${index}`}><td><strong>{row.eventName || 'Não identificado'}</strong></td><td>{EVENT_PT[row.eventName] || 'Evento personalizado'}</td><td>{number(row.eventCount)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}{!(report.events || []).length && <EmptyRows colSpan={5}/>}</tbody></table></div></article>
        <article className="corporate-card p-4"><h2 className="panel-title">Campanhas de aquisição</h2><p className="panel-subtitle">Campanhas identificadas por parâmetros UTM/GA4.</p><div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Campanha</th><th>Origem / mídia</th><th>Sessões</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>{(report.campaigns || []).filter((row) => row.sessionCampaignName && row.sessionCampaignName !== '(not set)').slice(0, 20).map((row, index) => <tr key={`${row.sessionCampaignName}-${row.sessionSourceMedium}-${index}`}><td><strong>{row.sessionCampaignName}</strong></td><td>{sourceMediumPt(row.sessionSourceMedium)}</td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}{!(report.campaigns || []).filter((row) => row.sessionCampaignName && row.sessionCampaignName !== '(not set)').length && <EmptyRows colSpan={5}/>}</tbody></table></div></article>
      </section>

      <section className="corporate-card p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="section-kicker">Google Ads via GA4</p><h2 className="panel-title">Desempenho de mídia paga</h2><p className="panel-subtitle">Custos e campanhas aparecem quando a conta Google Ads está vinculada à propriedade GA4 e possui dados no período.</p></div><BarChart3 size={18} className="text-[#2563eb]"/></div>
        {!ads?.available && <div className="message-warning mt-3">{ads?.warning}</div>}
        {ads?.available && <><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"><div className="mini-stat"><span>Investimento</span><strong>{money(adsTotals.cost)}</strong><small>Google Ads</small></div><div className="mini-stat"><span>Cliques</span><strong>{number(adsTotals.clicks)}</strong><small>CPC {money(adsTotals.cpc)}</small></div><div className="mini-stat"><span>Impressões</span><strong>{number(adsTotals.impressions)}</strong><small>CPM {money(adsTotals.cpm)}</small></div><div className="mini-stat"><span>CTR</span><strong>{percent(adsTotals.ctr || 0, 2)}</strong><small>cliques / impressões</small></div><div className="mini-stat"><span>Eventos principais</span><strong>{number(adsTotals.keyEvents || 0)}</strong><small>Custo {money(adsTotals.costPerKeyEvent)}</small></div><div className="mini-stat"><span>Taxa evento/sessão</span><strong>{percent(adsTotals.keyEventRate || 0)}</strong><small>atribuição GA4</small></div><div className="mini-stat"><span>Receita</span><strong>{money(adsTotals.revenue)}</strong><small>atribuída</small></div><div className="mini-stat"><span>ROAS</span><strong>{decimal(adsTotals.roas || 0)}x</strong><small>receita / custo</small></div></div><div className="table-scroll mt-4"><table className="corporate-table"><thead><tr><th>Campanha Google Ads</th><th>Sessões</th><th>Investimento</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Eventos</th><th>Custo/evento</th><th>Receita</th><th>ROAS</th></tr></thead><tbody>{ads.campaigns.map((row: any, index: number) => <tr key={`${row.customerId}-${row.name}-${index}`}><td><strong>{row.name}</strong><small>{row.customerId ? `Conta ${row.customerId}` : 'Google Ads'}</small></td><td>{number(row.sessions)}</td><td>{money(row.cost)}</td><td>{number(row.clicks)}</td><td>{percent(row.ctr || 0, 2)}</td><td>{money(row.cpc)}</td><td>{money(row.cpm)}</td><td>{number(row.keyEvents)}</td><td>{money(row.costPerKeyEvent)}</td><td>{money(row.revenue)}</td><td>{decimal(row.roas)}x</td></tr>)}{!ads.campaigns.length && <EmptyRows colSpan={11} text="Nenhuma campanha Google Ads com dados atribuídos no período."/>}</tbody></table></div></>}
      </section>

      <section className="corporate-card p-4">
        <div className="flex items-start gap-3"><span className="metric-icon"><WalletCards size={15}/></span><div><p className="section-kicker">Financeiro Google Ads</p><h2 className="panel-title">Saldo e histórico de pagamentos</h2><p className="panel-subtitle">O investimento acima vem do GA4. O saldo de pagamentos e o histórico de recargas não são estimados nem inventados.</p></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-3"><div className="mini-stat"><span>Custo atribuído no período</span><strong>{money(adsTotals.cost || 0)}</strong><small>dado real do Google Ads vinculado ao GA4</small></div><div className="mini-stat"><span>Saldo de pagamentos</span><strong>Não exposto pelo GA4</strong><small>A integração atual não fornece saldo pré/pós-pago em tempo real.</small></div><div className="mini-stat"><span>Histórico de faturamento</span><strong>Recurso específico</strong><small>{ads?.billing?.reason || 'A Google Ads API de faturamento exige configuração própria e elegibilidade de faturamento.'}</small></div></div>
      </section>

      <section className="corporate-card p-4 text-[10px] text-slate-500"><span>Fonte: <strong>Google Analytics Data API (GA4)</strong></span> · <span>Atualizado em <strong>{new Date(report.updatedAt).toLocaleString('pt-BR')}</strong></span> · <span>atualização automática a cada <strong>5 minutos</strong></span> · <a className="inline-flex items-center gap-1 font-semibold text-[#2563eb]" href="https://analytics.google.com/" target="_blank" rel="noreferrer">Abrir Google Analytics <ExternalLink size={10}/></a></section>
    </>}

    {clientId && connection?.status === 'active' && !effectivePropertyId && <div className="empty-state corporate-card p-6"><BarChart3 size={20}/><span>{canAdmin ? (propertiesLoaded && properties.length === 0 ? 'Nenhuma propriedade GA4 cadastrada ou acessível foi encontrada nessa conta Google.' : 'Selecione uma propriedade GA4 para iniciar a análise.') : 'O administrador ainda não vinculou uma propriedade GA4 a esta empresa.'}</span></div>}
  </div>;
}
