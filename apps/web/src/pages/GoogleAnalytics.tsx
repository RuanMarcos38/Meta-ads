import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Link2,
  MousePointerClick,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Unplug,
  Users,
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
  keyEventRate?: number;
  newUserRate?: number;
  revenuePerSession?: number;
};

type Report = {
  client: { id: string; name: string };
  property: { id: string; name?: string | null };
  period: { since: string; until: string };
  previousPeriod?: { since: string; until: string };
  summary: Summary;
  previousSummary?: Summary | null;
  realtime?: { available: boolean; activeUsers: number; warning?: string | null };
  daily: Array<{ date: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  channels: Array<{
    sessionDefaultChannelGroup: string;
    sessions: number;
    totalUsers: number;
    newUsers: number;
    engagedSessions: number;
    engagementRate: number;
    keyEvents: number;
    totalRevenue: number;
  }>;
  sources?: Array<{
    sessionSourceMedium: string;
    sessions: number;
    totalUsers: number;
    newUsers: number;
    engagedSessions: number;
    engagementRate: number;
    keyEvents: number;
    totalRevenue: number;
  }>;
  landingPages?: Array<{
    landingPagePlusQueryString: string;
    sessions: number;
    totalUsers: number;
    newUsers: number;
    engagementRate: number;
    keyEvents: number;
    totalRevenue: number;
  }>;
  pages?: Array<{
    pagePathPlusQueryString: string;
    screenPageViews: number;
    totalUsers: number;
    keyEvents: number;
    totalRevenue: number;
  }>;
  devices?: Array<{ deviceCategory: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  countries?: Array<{ country: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  cities?: Array<{ city: string; sessions: number; totalUsers: number; keyEvents: number; totalRevenue: number }>;
  events?: Array<{ eventName: string; eventCount: number; keyEvents: number; totalRevenue: number }>;
  campaigns?: Array<{
    sessionCampaignName: string;
    sessionSourceMedium: string;
    sessions: number;
    totalUsers: number;
    keyEvents: number;
    totalRevenue: number;
  }>;
  googleAds: { available: boolean; warning?: string | null; totals: any; campaigns: any[] };
  updatedAt: string;
};

const AUTO_REFRESH_MS = 5 * 60 * 1000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

function periodDays(days: number) {
  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - Math.max(0, days - 1));
  return { since: iso(since), until: iso(until) };
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const number = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(value || 0));
const decimal = (value: number, digits = 2) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value || 0));
const percent = (value: number, digits = 1) => `${decimal(Number(value || 0) * 100, digits)}%`;

function duration(seconds: number) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return minutes ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function formatGaDate(value: string) {
  if (value?.length === 8) return `${value.slice(6, 8)}/${value.slice(4, 6)}`;
  return value || '-';
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
  return <span className={`inline-flex items-center gap-1 ${positive ? 'text-emerald-700' : 'text-amber-700'}`}>
    <Icon size={11}/>{decimal(Math.abs(delta) * 100, 1)}% vs. período anterior
  </span>;
}

function KpiCard({ label, value, detail, trend, icon }: { label: string; value: string; detail: ReactNode; trend?: ReactNode; icon?: ReactNode }) {
  return <div className="mini-stat min-h-[112px]">
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      {icon && <span className="text-slate-400">{icon}</span>}
    </div>
    <strong>{value}</strong>
    <small>{detail}</small>
    {trend && <small>{trend}</small>}
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
  const [propertyId, setPropertyId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');

  const clientId = scope.clientId || ((user?.role === 'CLIENT' || user?.role === 'MANAGER') ? user?.clientId || '' : '');
  const clientName = useMemo(
    () => scope.clients.find((c) => c.id === clientId)?.name || report?.client?.name || 'Empresa selecionada',
    [scope.clients, clientId, report],
  );

  async function fetchStatus(): Promise<Connection | null> {
    if (!clientId) {
      setConnection(null);
      setReport(null);
      return null;
    }
    const response = await api.get('/google-analytics/status', { params: { clientId } });
    setConfigured(Boolean(response.data?.data?.configured));
    const rows = Array.isArray(response.data?.data?.rows) ? response.data.data.rows : [];
    const current = rows.find((row: Connection) => row.clientId === clientId) || null;
    setConnection(current);
    setPropertyId(current?.propertyId || '');
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

  async function fetchReport(current: Connection) {
    if (!clientId || current.status !== 'active' || !current.propertyId) return;
    setLoading(true);
    try {
      const response = await api.get('/google-analytics/decision-report', { params: { clientId, since, until } });
      setReport(response.data?.data || null);
    } finally {
      setLoading(false);
    }
  }

  async function syncGoogleState(withReport = true) {
    if (!clientId) return;
    setVerifying(true);
    setError('');
    try {
      let current = await fetchStatus();

      if (current?.status === 'active' && canAdmin) {
        const availableProperties = await fetchProperties();

        if (current.propertyId && !availableProperties.some((item) => item.propertyId === current?.propertyId)) {
          setPropertyId('');
          setReport(null);
          setError('A propriedade GA4 anteriormente vinculada não está mais acessível pela conta Google conectada. Somente propriedades disponíveis no Google Analytics dessa conta são exibidas.');
          return;
        }

        if (!current.propertyId && availableProperties.length === 1) {
          const onlyProperty = availableProperties[0];
          await api.patch('/google-analytics/property', { clientId, propertyId: onlyProperty.propertyId });
          current = await fetchStatus();
        }
      }

      if (withReport && current?.status === 'active' && current.propertyId) {
        await fetchReport(current);
      }
    } catch (e: any) {
      if (e?.response?.status === 409) {
        setProperties([]);
        setPropertiesLoaded(true);
      } else {
        setError(e?.response?.data?.error?.message || 'Não foi possível verificar automaticamente o Google Analytics.');
      }
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => {
    setReport(null);
    setProperties([]);
    setPropertiesLoaded(false);
    setPropertiesCheckedAt(null);
    setError('');
    if (clientId) void syncGoogleState(true);
    else {
      setConnection(null);
      setPropertyId('');
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    const timer = window.setInterval(() => {
      void syncGoogleState(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [clientId, since, until, canAdmin]);

  async function connect() {
    if (!clientId) return;
    setAction('connect');
    setError('');
    const popup = window.open('about:blank', 'gestao-ads-google-analytics-oauth', 'width=760,height=860');
    try {
      const response = await api.get('/google-analytics/oauth/start', { params: { clientId } });
      const url = response.data?.data?.authUrl;
      if (!url) throw new Error('URL OAuth ausente');
      if (popup) popup.location.href = url;
      else window.location.assign(url);

      const timer = window.setInterval(async () => {
        if (popup?.closed) {
          window.clearInterval(timer);
          setAction('');
          await syncGoogleState(true);
        }
      }, 1000);
    } catch (e: any) {
      popup?.close();
      setAction('');
      setError(e?.response?.data?.error?.message || 'Não foi possível iniciar a conexão com o Google Analytics.');
    }
  }

  async function saveProperty() {
    if (!clientId || !propertyId) return;
    setAction('property');
    setError('');
    try {
      if (propertiesLoaded && !properties.some((item) => item.propertyId === propertyId)) {
        throw new Error('Esta propriedade não está disponível para a conta Google conectada.');
      }
      await api.patch('/google-analytics/property', { clientId, propertyId });
      await syncGoogleState(true);
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Não foi possível vincular a propriedade GA4.');
    } finally {
      setAction('');
    }
  }

  async function disconnect() {
    if (!clientId || !window.confirm('Desconectar o Google Analytics desta empresa? A propriedade selecionada e a auditoria serão preservadas.')) return;
    setAction('disconnect');
    try {
      await api.post('/google-analytics/disconnect', { clientId });
      setReport(null);
      setProperties([]);
      setPropertiesLoaded(false);
      await fetchStatus();
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Não foi possível desconectar o Google Analytics.');
    } finally {
      setAction('');
    }
  }

  function applyPeriod(days: number) {
    const period = periodDays(days);
    setSince(period.since);
    setUntil(period.until);
  }

  const ads = report?.googleAds;
  const adsTotals = ads?.totals || {};
  const propertyStillAccessible = !canAdmin || !connection?.propertyId || !propertiesLoaded || properties.some((item) => item.propertyId === connection.propertyId);

  const dailyChart = useMemo(() => (report?.daily || []).map((row) => ({
    ...row,
    label: formatGaDate(row.date),
  })), [report]);

  const channelChart = useMemo(() => (report?.channels || []).slice(0, 8).map((row) => ({
    name: row.sessionDefaultChannelGroup || 'Não identificado',
    sessions: row.sessions,
    keyEvents: row.keyEvents,
  })), [report]);

  const insights = useMemo(() => {
    if (!report) return [];
    const rows: Array<{ title: string; text: string; tone: 'good' | 'attention' | 'neutral' }> = [];
    const topChannel = report.channels?.[0];
    const topDevice = report.devices?.[0];
    const summary = report.summary;

    if (topChannel) {
      const share = summary.sessions ? topChannel.sessions / summary.sessions : 0;
      rows.push({
        title: 'Principal canal de aquisição',
        text: `${topChannel.sessionDefaultChannelGroup || 'Não identificado'} concentra ${percent(share)} das sessões e gerou ${number(topChannel.keyEvents)} eventos principais no período.`,
        tone: 'neutral',
      });
    }

    if (summary.engagementRate || summary.bounceRate) {
      const engagementGood = summary.engagementRate >= 0.6;
      rows.push({
        title: 'Qualidade do tráfego',
        text: `Engajamento em ${percent(summary.engagementRate)} e rejeição em ${percent(summary.bounceRate || 0)}. ${engagementGood ? 'O nível de engajamento está saudável para aprofundar os canais que mais convertem.' : 'Vale revisar páginas de entrada, promessa do anúncio e velocidade/clareza da experiência.'}`,
        tone: engagementGood ? 'good' : 'attention',
      });
    }

    if (topDevice) {
      const share = summary.sessions ? topDevice.sessions / summary.sessions : 0;
      rows.push({
        title: 'Experiência por dispositivo',
        text: `${topDevice.deviceCategory || 'Dispositivo não identificado'} representa ${percent(share)} das sessões. Priorize testes e otimizações nessa experiência antes de mudanças amplas.`,
        tone: 'neutral',
      });
    }

    if (ads?.available && Number(adsTotals.cost || 0) > 0) {
      const roas = Number(adsTotals.roas || 0);
      rows.push({
        title: 'Eficiência Google Ads',
        text: `Investimento de ${money(adsTotals.cost)} com ROAS de ${decimal(roas)}x e CPA por evento principal de ${money(adsTotals.costPerKeyEvent || 0)}. ${roas >= 2 ? 'Há sinal positivo de retorno; valide margem e qualidade das conversões antes de escalar.' : 'O retorno atribuído pede revisão de campanhas, termos, páginas e configuração dos eventos principais.'}`,
        tone: roas >= 2 ? 'good' : 'attention',
      });
    } else {
      rows.push({
        title: 'Eficiência de conversão',
        text: `${number(summary.keyEvents)} eventos principais em ${number(summary.sessions)} sessões, equivalente a ${percent(summary.keyEventRate || 0)} eventos principais por sessão. Use os relatórios de origem e landing page abaixo para localizar onde a conversão acontece.`,
        tone: 'neutral',
      });
    }

    return rows.slice(0, 4);
  }, [report, ads?.available, adsTotals.cost, adsTotals.roas, adsTotals.costPerKeyEvent]);

  return <div className="space-y-4">
    <section className="page-heading">
      <div>
        <p className="section-kicker">Mensuração</p>
        <h1>Google Analytics & Google Ads</h1>
        <p>Dashboard completo de aquisição, comportamento, conversão e mídia paga para tomada de decisão, preservando a integração Google já existente por empresa.</p>
      </div>
      <button className="secondary-button" disabled={loading || verifying || !clientId} onClick={() => { void syncGoogleState(true); }}>
        <RefreshCw size={14} className={(loading || verifying) ? 'animate-spin' : ''}/>{verifying ? 'Verificando...' : 'Atualizar dados'}
      </button>
    </section>

    {!clientId && <div className="message-warning">Selecione uma empresa no filtro superior para consultar o Google Analytics.</div>}
    {error && <div className="message-warning">{error}</div>}

    {clientId && <section className="corporate-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="panel-title">{clientName}</h2>
          <p className="panel-subtitle">Integração individual por empresa · dados reais da propriedade GA4 selecionada.</p>
        </div>
        <span className={`status-chip ${connection?.status === 'active' ? 'status-success' : 'status-neutral'}`}>
          {connection?.status === 'active' ? <CheckCircle2 size={12}/> : <Unplug size={12}/>} {connection?.status === 'active' ? 'Google conectado' : 'Google desconectado'}
        </span>
      </div>

      {!configured && canAdmin && <div className="message-warning mt-3">O módulo está instalado, mas o OAuth do Google precisa das variáveis GOOGLE_ANALYTICS_CLIENT_ID e GOOGLE_ANALYTICS_CLIENT_SECRET no EasyPanel.</div>}

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        {canAdmin && <>
          <div>
            <label className="field-label">Propriedade GA4</label>
            <select
              className="field-control w-full"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              disabled={connection?.status !== 'active' || verifying}
            >
              <option value="">
                {connection?.status !== 'active'
                  ? 'Conecte a conta Google primeiro'
                  : !propertiesLoaded
                    ? 'Verificando propriedades cadastradas...'
                    : properties.length
                      ? 'Selecione a propriedade'
                      : 'Nenhuma propriedade GA4 disponível nesta conta'}
              </option>
              {properties.map((property) => <option key={property.propertyId} value={property.propertyId}>{property.accountName} · {property.propertyName} ({property.propertyId})</option>)}
            </select>
            <p className="mt-1 text-[10px] leading-4 text-slate-500">
              Somente propriedades cadastradas no Google Analytics e acessíveis pela conta Google conectada são exibidas. A verificação e os dados são atualizados automaticamente a cada 5 minutos.
              {propertiesCheckedAt && <> Última verificação: {new Date(propertiesCheckedAt).toLocaleString('pt-BR')}.</>}
            </p>
          </div>
          <div className="flex items-end">
            <button className="secondary-button" disabled={!propertyId || action === 'property' || propertyId === connection?.propertyId || verifying} onClick={() => { void saveProperty(); }}>Salvar propriedade</button>
          </div>
        </>}

        <div className="flex items-end gap-2">
          {canAdmin && <button className="primary-button" disabled={!configured || action === 'connect'} onClick={() => { void connect(); }}><Link2 size={13}/>{connection?.status === 'active' ? 'Reconectar Google' : 'Conectar Google'}</button>}
          {canAdmin && connection?.status === 'active' && <button className="secondary-button text-red-600" disabled={action === 'disconnect'} onClick={() => { void disconnect(); }}><Unplug size={13}/>Desconectar</button>}
        </div>
      </div>

      {connection?.propertyId && propertyStillAccessible && <div className="mt-3 rounded-[7px] bg-[#f5f7f5] p-3 text-[10px] text-slate-600">
        <strong>{connection.propertyName || 'Propriedade GA4'}</strong> · ID {connection.propertyId}
        {connection.lastSyncAt && <> · última consulta {new Date(connection.lastSyncAt).toLocaleString('pt-BR')}</>}
        {connection.lastError && <p className="mt-1 text-amber-700">{connection.lastError}</p>}
      </div>}
    </section>}

    {clientId && connection?.status === 'active' && connection.propertyId && propertyStillAccessible && <section className="filter-panel">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="field-label">De</label><input className="field-control" type="date" value={since} onChange={(e) => setSince(e.target.value)}/></div>
        <div><label className="field-label">Até</label><input className="field-control" type="date" value={until} onChange={(e) => setUntil(e.target.value)}/></div>
        <div className="flex gap-1">{[7, 30, 90].map((days) => <button key={days} className="secondary-button" onClick={() => applyPeriod(days)}>{days} dias</button>)}</div>
        <button className="primary-button" disabled={loading || verifying} onClick={() => { void syncGoogleState(true); }}><RefreshCw size={13} className={(loading || verifying) ? 'animate-spin' : ''}/>Aplicar período</button>
      </div>
    </section>}

    {report && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Sessões" value={number(report.summary.sessions)} detail="Visitas no período" trend={<Trend current={report.summary.sessions} previous={report.previousSummary?.sessions}/>} icon={<Activity size={15}/>}/>
        <KpiCard label="Usuários" value={number(report.summary.totalUsers)} detail={`${number(report.summary.newUsers)} novos · ${percent(report.summary.newUserRate || 0)} do total`} trend={<Trend current={report.summary.totalUsers} previous={report.previousSummary?.totalUsers}/>} icon={<Users size={15}/>}/>
        <KpiCard label="Engajamento" value={percent(report.summary.engagementRate)} detail={`${number(report.summary.engagedSessions)} sessões engajadas · rejeição ${percent(report.summary.bounceRate || 0)}`} trend={<Trend current={report.summary.engagementRate} previous={report.previousSummary?.engagementRate}/>} icon={<Gauge size={15}/>}/>
        <KpiCard label="Eventos principais" value={number(report.summary.keyEvents)} detail={`${percent(report.summary.keyEventRate || 0)} por sessão`} trend={<Trend current={report.summary.keyEvents} previous={report.previousSummary?.keyEvents}/>} icon={<MousePointerClick size={15}/>}/>
        <KpiCard label="Visualizações" value={number(report.summary.screenPageViews || 0)} detail={`${decimal(report.summary.screenPageViewsPerSession || 0)} páginas/telas por sessão`} icon={<BarChart3 size={15}/>}/>
        <KpiCard label="Duração média" value={duration(report.summary.averageSessionDuration || 0)} detail={`${number(report.summary.eventCount || 0)} eventos registrados`} icon={<Activity size={15}/>}/>
        <KpiCard label="Receita" value={money(report.summary.totalRevenue)} detail={`${money(report.summary.revenuePerSession || 0)} por sessão`} trend={<Trend current={report.summary.totalRevenue} previous={report.previousSummary?.totalRevenue}/>} icon={<TrendingUp size={15}/>}/>
        <KpiCard label="Agora no site/app" value={report.realtime?.available ? number(report.realtime.activeUsers) : '—'} detail={report.realtime?.available ? 'Usuários ativos em tempo real' : (report.realtime?.warning || 'Tempo real indisponível')} icon={<Activity size={15}/>}/>
      </section>

      <section className="corporate-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-kicker">Leitura executiva</p>
            <h2 className="panel-title">Indicadores para tomada de decisão</h2>
            <p className="panel-subtitle">Sinais calculados diretamente a partir dos dados da propriedade. Use como apoio e valide contexto comercial, margem e qualidade dos leads antes de agir.</p>
          </div>
          <span className="status-chip status-neutral">Período {new Date(`${report.period.since}T12:00:00`).toLocaleDateString('pt-BR')} a {new Date(`${report.period.until}T12:00:00`).toLocaleDateString('pt-BR')}</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {insights.map((item) => <article key={item.title} className={`rounded-[8px] border p-3 ${item.tone === 'good' ? 'border-emerald-200 bg-emerald-50/40' : item.tone === 'attention' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
            <strong className="text-xs text-slate-800">{item.title}</strong>
            <p className="mt-2 text-[11px] leading-5 text-slate-600">{item.text}</p>
          </article>)}
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4">
          <div><p className="section-kicker">Tendência</p><h2 className="panel-title">Evolução diária</h2><p className="panel-subtitle">Sessões e usuários ao longo do período selecionado.</p></div>
          <div className="mt-4 h-[300px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyChart} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24}/>
                <YAxis tick={{ fontSize: 10 }}/>
                <Tooltip formatter={(value: any) => number(Number(value || 0))}/>
                <Legend wrapperStyle={{ fontSize: 11 }}/>
                <Line type="monotone" dataKey="sessions" name="Sessões" stroke="#2563eb" strokeWidth={2} dot={false}/>
                <Line type="monotone" dataKey="totalUsers" name="Usuários" stroke="#0f766e" strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="corporate-card p-4">
          <div><p className="section-kicker">Aquisição</p><h2 className="panel-title">Sessões por canal</h2><p className="panel-subtitle">Compare volume de tráfego e eventos principais por canal.</p></div>
          <div className="mt-4 h-[300px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={channelChart} layout="vertical" margin={{ top: 8, right: 12, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false}/>
                <XAxis type="number" tick={{ fontSize: 10 }}/>
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }}/>
                <Tooltip formatter={(value: any) => number(Number(value || 0))}/>
                <Legend wrapperStyle={{ fontSize: 11 }}/>
                <Bar dataKey="sessions" name="Sessões" fill="#2563eb" radius={[0, 4, 4, 0]}/>
                <Bar dataKey="keyEvents" name="Eventos principais" fill="#0f766e" radius={[0, 4, 4, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4">
          <h2 className="panel-title">Canais de aquisição</h2>
          <p className="panel-subtitle">Volume, qualidade e resultado por agrupamento padrão do GA4.</p>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Canal</th><th>Sessões</th><th>Usuários</th><th>Engaj.</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>
            {report.channels.map((row, index) => <tr key={`${row.sessionDefaultChannelGroup}-${index}`}><td><strong>{row.sessionDefaultChannelGroup || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.totalUsers)}</td><td>{percent(row.engagementRate)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}
            {!report.channels.length && <EmptyRows colSpan={6}/>} 
          </tbody></table></div>
        </article>

        <article className="corporate-card p-4">
          <h2 className="panel-title">Origem / mídia</h2>
          <p className="panel-subtitle">Descubra quais fontes trazem tráfego, engajamento e eventos principais.</p>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Origem / mídia</th><th>Sessões</th><th>Usuários</th><th>Engaj.</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>
            {(report.sources || []).slice(0, 20).map((row, index) => <tr key={`${row.sessionSourceMedium}-${index}`}><td><strong>{row.sessionSourceMedium || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.totalUsers)}</td><td>{percent(row.engagementRate)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}
            {!(report.sources || []).length && <EmptyRows colSpan={6}/>} 
          </tbody></table></div>
        </article>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4">
          <h2 className="panel-title">Landing pages</h2>
          <p className="panel-subtitle">Páginas de entrada que recebem as sessões e participam dos eventos principais.</p>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Página de entrada</th><th>Sessões</th><th>Engaj.</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>
            {(report.landingPages || []).slice(0, 20).map((row, index) => <tr key={`${row.landingPagePlusQueryString}-${index}`}><td><strong>{row.landingPagePlusQueryString || '(não definido)'}</strong></td><td>{number(row.sessions)}</td><td>{percent(row.engagementRate)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}
            {!(report.landingPages || []).length && <EmptyRows colSpan={5}/>} 
          </tbody></table></div>
        </article>

        <article className="corporate-card p-4">
          <h2 className="panel-title">Páginas mais acessadas</h2>
          <p className="panel-subtitle">Conteúdos com maior volume de visualizações na propriedade.</p>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Página</th><th>Visualizações</th><th>Usuários</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>
            {(report.pages || []).slice(0, 20).map((row, index) => <tr key={`${row.pagePathPlusQueryString}-${index}`}><td><strong>{row.pagePathPlusQueryString || '(não definido)'}</strong></td><td>{number(row.screenPageViews)}</td><td>{number(row.totalUsers)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}
            {!(report.pages || []).length && <EmptyRows colSpan={5}/>} 
          </tbody></table></div>
        </article>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        <article className="corporate-card p-4">
          <h2 className="panel-title">Dispositivos</h2>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Dispositivo</th><th>Sessões</th><th>Eventos</th></tr></thead><tbody>
            {(report.devices || []).map((row, index) => <tr key={`${row.deviceCategory}-${index}`}><td><strong>{row.deviceCategory || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td></tr>)}
            {!(report.devices || []).length && <EmptyRows colSpan={3}/>} 
          </tbody></table></div>
        </article>

        <article className="corporate-card p-4">
          <h2 className="panel-title">Países</h2>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>País</th><th>Sessões</th><th>Eventos</th></tr></thead><tbody>
            {(report.countries || []).slice(0, 10).map((row, index) => <tr key={`${row.country}-${index}`}><td><strong>{row.country || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td></tr>)}
            {!(report.countries || []).length && <EmptyRows colSpan={3}/>} 
          </tbody></table></div>
        </article>

        <article className="corporate-card p-4">
          <h2 className="panel-title">Cidades</h2>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Cidade</th><th>Sessões</th><th>Eventos</th></tr></thead><tbody>
            {(report.cities || []).slice(0, 10).map((row, index) => <tr key={`${row.city}-${index}`}><td><strong>{row.city || 'Não identificado'}</strong></td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td></tr>)}
            {!(report.cities || []).length && <EmptyRows colSpan={3}/>} 
          </tbody></table></div>
        </article>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="corporate-card p-4">
          <h2 className="panel-title">Eventos</h2>
          <p className="panel-subtitle">Eventos mais frequentes e quantos foram marcados como eventos principais.</p>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Evento</th><th>Contagem</th><th>Principais</th><th>Receita</th></tr></thead><tbody>
            {(report.events || []).slice(0, 20).map((row, index) => <tr key={`${row.eventName}-${index}`}><td><strong>{row.eventName || 'Não identificado'}</strong></td><td>{number(row.eventCount)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}
            {!(report.events || []).length && <EmptyRows colSpan={4}/>} 
          </tbody></table></div>
        </article>

        <article className="corporate-card p-4">
          <h2 className="panel-title">Campanhas de aquisição</h2>
          <p className="panel-subtitle">Campanhas identificadas por UTM/GA4, independentemente de serem mídia paga.</p>
          <div className="table-scroll mt-3"><table className="corporate-table"><thead><tr><th>Campanha</th><th>Origem / mídia</th><th>Sessões</th><th>Eventos</th><th>Receita</th></tr></thead><tbody>
            {(report.campaigns || []).filter((row) => row.sessionCampaignName && row.sessionCampaignName !== '(not set)').slice(0, 20).map((row, index) => <tr key={`${row.sessionCampaignName}-${row.sessionSourceMedium}-${index}`}><td><strong>{row.sessionCampaignName}</strong></td><td>{row.sessionSourceMedium || '-'}</td><td>{number(row.sessions)}</td><td>{number(row.keyEvents)}</td><td>{money(row.totalRevenue)}</td></tr>)}
            {!(report.campaigns || []).filter((row) => row.sessionCampaignName && row.sessionCampaignName !== '(not set)').length && <EmptyRows colSpan={5}/>} 
          </tbody></table></div>
        </article>
      </section>

      <section className="corporate-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="section-kicker">Google Ads via GA4</p><h2 className="panel-title">Desempenho de mídia paga</h2><p className="panel-subtitle">Custos e campanhas aparecem quando a conta Google Ads está vinculada à propriedade GA4 e possui dados no período.</p></div>
          <BarChart3 size={18} className="text-[#2563eb]"/>
        </div>
        {!ads?.available && <div className="message-warning mt-3">{ads?.warning}</div>}
        {ads?.available && <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <div className="mini-stat"><span>Investimento</span><strong>{money(adsTotals.cost)}</strong><small>Google Ads</small></div>
            <div className="mini-stat"><span>Cliques</span><strong>{number(adsTotals.clicks)}</strong><small>CPC {money(adsTotals.cpc)}</small></div>
            <div className="mini-stat"><span>Impressões</span><strong>{number(adsTotals.impressions)}</strong><small>CPM {money(adsTotals.cpm)}</small></div>
            <div className="mini-stat"><span>CTR</span><strong>{percent(adsTotals.ctr || 0, 2)}</strong><small>cliques / impressões</small></div>
            <div className="mini-stat"><span>Eventos principais</span><strong>{number(adsTotals.keyEvents || 0)}</strong><small>CPA {money(adsTotals.costPerKeyEvent)}</small></div>
            <div className="mini-stat"><span>Taxa evento/sessão</span><strong>{percent(adsTotals.keyEventRate || 0)}</strong><small>atribuição GA4</small></div>
            <div className="mini-stat"><span>Receita</span><strong>{money(adsTotals.revenue)}</strong><small>atribuída</small></div>
            <div className="mini-stat"><span>ROAS</span><strong>{decimal(adsTotals.roas || 0)}x</strong><small>receita / custo</small></div>
          </div>
          <div className="table-scroll mt-4"><table className="corporate-table"><thead><tr><th>Campanha Google Ads</th><th>Sessões</th><th>Investimento</th><th>Cliques</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Eventos</th><th>CPA</th><th>Receita</th><th>ROAS</th></tr></thead><tbody>
            {ads.campaigns.map((row: any, index: number) => <tr key={`${row.customerId}-${row.name}-${index}`}><td><strong>{row.name}</strong><small>{row.customerId ? `Conta ${row.customerId}` : 'Google Ads'}</small></td><td>{number(row.sessions)}</td><td>{money(row.cost)}</td><td>{number(row.clicks)}</td><td>{percent(row.ctr || 0, 2)}</td><td>{money(row.cpc)}</td><td>{money(row.cpm)}</td><td>{number(row.keyEvents)}</td><td>{money(row.costPerKeyEvent)}</td><td>{money(row.revenue)}</td><td>{decimal(row.roas)}x</td></tr>)}
            {!ads.campaigns.length && <EmptyRows colSpan={11} text="Nenhuma campanha Google Ads com dados atribuídos no período."/>}
          </tbody></table></div>
        </>}
      </section>

      <section className="corporate-card p-4 text-[10px] text-slate-500">
        <span>Fonte: <strong>Google Analytics Data API (GA4)</strong></span> · <span>Atualizado em <strong>{new Date(report.updatedAt).toLocaleString('pt-BR')}</strong></span> · <span>atualização automática a cada <strong>5 minutos</strong></span> · <a className="inline-flex items-center gap-1 font-semibold text-[#2563eb]" href="https://analytics.google.com/" target="_blank" rel="noreferrer">Abrir Google Analytics <ExternalLink size={10}/></a>
      </section>
    </>}

    {clientId && connection?.status === 'active' && !connection.propertyId && <div className="empty-state corporate-card p-6"><BarChart3 size={20}/><span>{canAdmin ? (propertiesLoaded && properties.length === 0 ? 'Nenhuma propriedade GA4 cadastrada ou acessível foi encontrada nessa conta Google.' : 'As propriedades GA4 da conta conectada estão sendo verificadas automaticamente.') : 'O administrador ainda não vinculou uma propriedade GA4 a esta empresa.'}</span></div>}
  </div>;
}
