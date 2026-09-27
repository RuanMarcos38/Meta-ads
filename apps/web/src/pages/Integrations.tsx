import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Link2, RefreshCw, ShieldAlert, Unplug, Wrench } from 'lucide-react';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type Health = {
  id: string;
  clientId: string;
  clientName: string;
  businessId: string;
  businessName: string;
  adminEmail?: string | null;
  connected: boolean;
  tokenStatus: string;
  tokenExpiresAt?: string | null;
  scopes?: string;
  accountCount: number;
  assignedAccountCount: number;
  lastSyncAt?: string | null;
  lastSyncStatus: string;
  recordsProcessed: number;
  lastError?: string | null;
  earliestDate?: string | null;
  latestDate?: string | null;
};

type RefreshResult = {
  clientId?: string;
  name?: string;
  businesses?: number;
  mappedAccounts?: number;
  ok?: boolean;
  error?: string;
};

type ManagementStatus = {
  connected: boolean;
  connection?: {
    id: string;
    metaUserId?: string | null;
    tokenExpiresAt?: string | null;
    scopes?: string | null;
    updatedAt?: string | null;
  } | null;
};

const META_RATE_LIMIT_NOTICE = 'A Meta atingiu o limite temporário de requisições (#4). A conexão e o token continuam válidos, e os dados já sincronizados foram preservados. Aguarde a liberação da Meta antes de atualizar novamente.';

function isMetaRateLimitMessage(value: unknown) {
  const message = String(value || '').toLowerCase();
  return message.includes('application request limit reached')
    || message.includes('(#4)')
    || message.includes('request limit')
    || message.includes('rate limit');
}

function friendlyMetaError(value: unknown) {
  if (!value) return '';
  return isMetaRateLimitMessage(value)
    ? 'Limite temporário da Meta (#4). Conexão preservada; tente sincronizar novamente mais tarde.'
    : String(value);
}

export default function Integrations() {
  const user = useAuth((s) => s.user);
  const scope = useScope();
  const canAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');
  const [rows, setRows] = useState<Health[]>([]);
  const [management, setManagement] = useState<ManagementStatus>({ connected: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [healthResponse, managementResponse] = await Promise.all([
        api.get('/workspace/integration-health', {
          params: {
            ...(scope.clientId ? { clientId: scope.clientId } : {}),
            ...(scope.businessId ? { businessId: scope.businessId } : {}),
          },
        }),
        canAdmin ? api.get('/meta/management-status') : Promise.resolve(null),
      ]);
      setRows(Array.isArray(healthResponse.data?.data) ? healthResponse.data.data : []);
      if (managementResponse) {
        setManagement(managementResponse.data?.data || { connected: false });
      }
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Não foi possível carregar o estado da integração.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [scope.clientId, scope.businessId]);

  async function connectManagement() {
    setAction('management');
    setError('');
    const popup = window.open('about:blank', 'gestao-ads-meta-oauth', 'width=760,height=860');
    try {
      const r = await api.get('/meta/oauth/start-management');
      const url = r.data?.data?.authUrl;
      if (!url) throw new Error('URL OAuth ausente');
      if (popup) popup.location.href = url;
      else window.location.assign(url);
      const timer = window.setInterval(async () => {
        if (popup?.closed) {
          clearInterval(timer);
          setAction('');
          window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
          await load();
        }
      }, 1000);
    } catch (e: any) {
      popup?.close();
      setAction('');
      setError(e?.response?.data?.error?.message || 'Não foi possível conectar a ferramenta à Meta.');
    }
  }

  async function refreshDirectory() {
    setAction('refresh');
    setError('');
    try {
      const response = await api.post('/workspace/business-managers/refresh', {});
      const results: RefreshResult[] = Array.isArray(response.data?.data) ? response.data.data : [];
      const failures = results.filter((item) => item.ok === false);
      if (failures.some((item) => isMetaRateLimitMessage(item.error))) {
        setError(META_RATE_LIMIT_NOTICE);
      } else if (failures.length) {
        setError(failures.map((item) => `${item.name || 'Empresa'}: ${item.error || 'Falha ao consultar a Meta.'}`).join(' | '));
      }
      window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
      await load();
    } catch (e: any) {
      const message = e?.response?.data?.error?.message || 'Não foi possível atualizar as BMs.';
      setError(isMetaRateLimitMessage(message) ? META_RATE_LIMIT_NOTICE : message);
    } finally {
      setAction('');
    }
  }

  const clients = scope.clientId ? scope.clients.filter((c) => c.id === scope.clientId) : scope.clients;

  return <div className="space-y-4">
    <section className="page-heading">
      <div>
        <p className="section-kicker">Configurações</p>
        <h1>Integração Meta</h1>
        <p>Conexão, token, permissões, contas e sincronização ficam concentrados aqui, sem poluir as telas operacionais.</p>
      </div>
      {canAdmin && <button className="secondary-button" onClick={() => { void refreshDirectory(); }} disabled={action === 'refresh'}>
        <RefreshCw size={14} className={action === 'refresh' ? 'animate-spin' : ''} />Atualizar BMs
      </button>}
    </section>

    {error && <div className="message-warning">{error}</div>}

    {canAdmin && <section className="corporate-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className={`mt-0.5 rounded-[7px] p-2 ${management.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {management.connected ? <CheckCircle2 size={18} /> : <Unplug size={18} />}
          </div>
          <div>
            <h2 className="panel-title">Conexão principal da ferramenta com a Meta</h2>
            <p className="panel-subtitle">Uma única conexão da R2R consulta as BMs disponíveis. Depois, cada BM é vinculada somente à empresa correta.</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
              <span>Status: <strong>{management.connected ? 'Conectada' : 'Desconectada'}</strong></span>
              <span>Escopo: <strong>Organização inteira</strong></span>
              {management.connection?.tokenExpiresAt && <span>Token: <strong>até {new Date(management.connection.tokenExpiresAt).toLocaleDateString('pt-BR')}</strong></span>}
            </div>
          </div>
        </div>
        <button className="primary-button" disabled={action === 'management'} onClick={() => { void connectManagement(); }}>
          <Link2 size={13} />{action === 'management' ? 'Conectando...' : management.connected ? 'Reconectar ferramenta à Meta' : 'Conectar ferramenta à Meta'}
        </button>
      </div>
    </section>}

    <section className="grid gap-3 lg:grid-cols-2">
      {clients.map((client) => {
        const clientRows = rows.filter((r) => r.clientId === client.id);
        return <article key={client.id} className="corporate-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold">{client.name}</h2>
              <p className="panel-subtitle">{clientRows.length} BM(s) vinculada(s) exclusivamente a esta empresa</p>
            </div>
            <span className={`status-chip ${clientRows.length ? 'status-success' : 'status-neutral'}`}>
              {clientRows.length ? <CheckCircle2 size={12} /> : <Wrench size={12} />} {clientRows.length ? 'Mapeada' : 'Sem BM'}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {clientRows.map((row) => <div key={row.id} className="rounded-[7px] border border-[#e1e6e3] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong className="text-[11px]">{row.businessName}</strong>
                  <small className="block text-[9px] text-slate-400">BM {row.businessId}</small>
                </div>
                <span className="status-chip status-success">{row.assignedAccountCount} conta(s)</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-500">
                <span>Última sync: <b>{row.lastSyncAt ? new Date(row.lastSyncAt).toLocaleString('pt-BR') : '—'}</b></span>
                <span>Status: <b>{row.lastSyncStatus}</b></span>
              </div>
              {row.lastError && <p className="mt-2 text-[10px] text-amber-700">{friendlyMetaError(row.lastError)}</p>}
            </div>)}
            {!clientRows.length && <div className="rounded-[7px] bg-[#f5f7f5] p-3 text-[10px] text-slate-500">
              <Wrench size={14} className="mb-1" />Abra Empresas e selecione quais BMs pertencem a este cliente.
            </div>}
          </div>
        </article>;
      })}
    </section>

    <section className="corporate-card p-4">
      <div className="flex gap-3">
        <ShieldAlert size={17} className="mt-0.5 text-[#176846]" />
        <div>
          <h2 className="panel-title">Detalhes técnicos</h2>
          <p className="panel-subtitle">Exibidos apenas nesta área administrativa.</p>
          <div className="mt-3 grid gap-2 text-[10px] text-slate-500 md:grid-cols-2">
            <span>API: <strong>https://api-gestao.r2rmarketingdigital.com.br</strong></span>
            <span>Atualização automática: <strong>a cada 5 minutos</strong></span>
            <span>Permissões: <strong>ads_read, ads_management, business_management</strong></span>
            <span>Histórico: <strong>preservado ao desconectar</strong></span>
          </div>
          <p className="mt-3 text-[9px] leading-4 text-slate-500">Em caso de limite temporário da Meta (#4), a ferramenta mantém a autorização e os dados existentes. Não é necessário reconectar a conta; aguarde a quota normalizar antes de atualizar as BMs novamente.</p>
          <a className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-[#176846]" href="https://business.facebook.com/" target="_blank" rel="noreferrer">
            Abrir Gerenciador da Meta <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </section>
  </div>;
}
