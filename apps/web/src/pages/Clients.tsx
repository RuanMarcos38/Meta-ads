import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../store';

type MetaClientStatus = {
  clientId: string;
  connected: boolean;
  accountCount: number;
  tokenExpiresAt?: string | null;
  connectedAt?: string | null;
};

type MetaDiagnostics = {
  configured: boolean;
  graphReachable: boolean;
  appCredentialsValid: boolean;
  graphErrorCode?: string | number | null;
  apiVersion: string;
  recommendedApiVersion: string;
  apiVersionCurrent: boolean;
  redirectUri: string;
  redirectUriMatchesProduction: boolean;
  expectedRedirectUri: string;
  expectedAppDomains: string[];
  requiredScopes: string[];
  activeConnections: number;
  activeAccounts: number;
};

export default function Clients() {
  const user = useAuth((state) => state.user);
  const canView = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const canCreate = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectingId, setConnectingId] = useState('');
  const [metaConfigured, setMetaConfigured] = useState(true);
  const [metaStatuses, setMetaStatuses] = useState<Record<string, MetaClientStatus>>({});
  const [diagnostics, setDiagnostics] = useState<MetaDiagnostics | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    if (!canView) {
      setLoading(false);
      return;
    }

    setError('');
    try {
      const [clientsResponse, metaResponse, diagnosticsResponse] = await Promise.all([
        api.get('/clients'),
        api.get('/meta/status').catch(() => null),
        canCreate ? api.get('/meta/diagnostics').catch(() => null) : Promise.resolve(null),
      ]);
      setRows(Array.isArray(clientsResponse.data.data) ? clientsResponse.data.data : []);

      const metaData = metaResponse?.data?.data;
      if (metaData) {
        setMetaConfigured(Boolean(metaData.configured));
        const entries = Array.isArray(metaData.clients) ? metaData.clients : [];
        setMetaStatuses(Object.fromEntries(entries.map((item: MetaClientStatus) => [item.clientId, item])));
      }

      const diagnosticsData = diagnosticsResponse?.data?.data as MetaDiagnostics | undefined;
      if (diagnosticsData) {
        setDiagnostics(diagnosticsData);
        setMetaConfigured(Boolean(diagnosticsData.configured));
      }
    } catch {
      setError('Não foi possível carregar os clientes deste acesso.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [canView]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || !canCreate) return;

    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.post('/clients', { name: normalizedName });
      setName('');
      setNotice('Cliente cadastrado com sucesso. Agora você pode conectar a conta Meta Ads.');
      await load();
    } catch {
      setError('O cliente não foi cadastrado. Verifique os dados e as permissões do usuário.');
    } finally {
      setSaving(false);
    }
  }

  async function connectMeta(clientId: string) {
    if (!canCreate) return;
    setConnectingId(clientId);
    setError('');
    setNotice('Abrindo a autorização oficial da Meta. Conclua o acesso na janela que será exibida.');

    const popup = window.open('about:blank', 'gestao-ads-meta-oauth', 'width=760,height=860');
    try {
      const response = await api.get('/meta/oauth/start-management', { params: { clientId } });
      const authUrl = response.data?.data?.authUrl as string | undefined;
      if (!authUrl) throw new Error('URL de autorização ausente');

      if (!popup) {
        window.location.assign(authUrl);
        return;
      }

      popup.location.href = authUrl;
      const startedAt = Date.now();
      const poll = window.setInterval(async () => {
        const timedOut = Date.now() - startedAt > 120_000;
        if (popup.closed || timedOut) {
          window.clearInterval(poll);
          setConnectingId('');
          const statusResponse = await api.get('/meta/status', { params: { clientId } }).catch(() => null);
          const statuses = statusResponse?.data?.data?.clients;
          const connected = Array.isArray(statuses)
            && statuses.some((item: MetaClientStatus) => item.clientId === clientId && item.connected);

          if (!connected) {
            setNotice('');
            setError(timedOut
              ? 'A Meta não concluiu a autorização. Se apareceu “URL bloqueada”, ajuste os Domínios do app e o Redirect OAuth no Meta Developers conforme o quadro abaixo.'
              : 'A janela da Meta foi fechada antes da conexão ser concluída.');
          }
          await load();
          return;
        }

        try {
          const statusResponse = await api.get('/meta/status', { params: { clientId } });
          const statuses = statusResponse.data?.data?.clients;
          const connected = Array.isArray(statuses)
            && statuses.some((item: MetaClientStatus) => item.clientId === clientId && item.connected);
          if (connected) {
            popup.close();
            window.clearInterval(poll);
            setConnectingId('');
            setNotice('Meta Ads conectado. As contas de anúncio já estão disponíveis para sincronização.');
            await load();
          }
        } catch {
          // O polling é apenas auxiliar; a janela OAuth continua funcionando normalmente.
        }
      }, 2500);
    } catch {
      popup?.close();
      setConnectingId('');
      setNotice('');
      setError('Não foi possível iniciar a conexão com a Meta. Confira as variáveis do app no EasyPanel.');
    }
  }

  if (!canView) {
    return <p className="rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-amber-800">Seu perfil não possui acesso ao cadastro de clientes.</p>;
  }

  const hasActiveConnection = Object.values(metaStatuses).some((item) => item.connected);
  const diagnosticsHealthy = Boolean(
    diagnostics?.configured
    && diagnostics?.appCredentialsValid
    && diagnostics?.redirectUriMatchesProduction,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Configuração comercial</p>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#17231d]">Clientes</h1>
          <p className="mt-1.5 text-sm text-slate-500">Cadastre cada operação e conecte suas contas Meta Ads com isolamento por cliente.</p>
        </div>
        <button
          onClick={() => { setLoading(true); void load(); }}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[9px] border border-brand-border bg-white px-3.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-[#f5f7f5]"
        >
          <RefreshCw size={15} />
          Atualizar
        </button>
      </div>

      {canCreate && diagnostics && !hasActiveConnection && (
        <section className="rounded-[12px] border border-[#dbe4dd] bg-[#f8faf8] p-4 md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-white text-brand-blue ring-1 ring-[#dbe4dd]">
                  <ShieldCheck size={17} />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[#213129]">Diagnóstico da integração Meta</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Configuração do backend e dados que devem coincidir no Meta Developers.</p>
                </div>
              </div>

              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-[9px] border border-[#e0e6e1] bg-white px-3.5 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Credenciais do app</p>
                  <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    {diagnostics.appCredentialsValid ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertTriangle size={15} className="text-amber-600" />}
                    {diagnostics.appCredentialsValid ? 'Validadas pelo backend' : 'Não validadas pela Meta'}
                  </div>
                </div>
                <div className="rounded-[9px] border border-[#e0e6e1] bg-white px-3.5 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Graph API</p>
                  <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    {diagnostics.apiVersionCurrent ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertTriangle size={15} className="text-amber-600" />}
                    {diagnostics.apiVersion}{diagnostics.apiVersionCurrent ? '' : ` · recomendado ${diagnostics.recommendedApiVersion}`}
                  </div>
                </div>
              </div>
            </div>

            <span className={[
              'inline-flex w-fit items-center rounded-full px-3 py-1.5 text-xs font-bold',
              diagnosticsHealthy ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800',
            ].join(' ')}>
              {diagnosticsHealthy ? 'Backend Meta preparado' : 'Ajustes externos necessários'}
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded-[9px] border border-[#e0e6e1] bg-white p-3.5 lg:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Valid OAuth Redirect URI</p>
              <p className="mt-2 break-all font-mono text-[12px] leading-5 text-slate-700">{diagnostics.expectedRedirectUri}</p>
            </div>
            <div className="rounded-[9px] border border-[#e0e6e1] bg-white p-3.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">App Domains</p>
              <div className="mt-2 space-y-1 font-mono text-[12px] leading-5 text-slate-700">
                {diagnostics.expectedAppDomains.map((domain) => <p key={domain}>{domain}</p>)}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-[9px] border border-[#e5e9e5] bg-white px-3.5 py-3 text-xs leading-5 text-slate-600">
            <strong className="font-bold text-slate-800">Se aparecer “URL bloqueada”:</strong> em Meta Developers, coloque os domínios acima em <strong>Configurações do app → Básico → Domínios do aplicativo</strong> sem <code>https://</code>. Depois coloque o redirect exato em <strong>Login do Facebook para Empresas → Configurações → URIs de redirecionamento OAuth válidos</strong>, com Client OAuth Login e Web OAuth Login ativados.
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <ExternalLink size={14} />
            Permissões solicitadas: {diagnostics.requiredScopes.join(', ')}
          </div>
        </section>
      )}

      {canCreate && (
        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome do cliente"
            minLength={2}
            required
            className="h-11 flex-1 rounded-[9px] border border-brand-border bg-white px-3.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#91b19f]"
          />
          <button disabled={saving} className="h-11 rounded-[9px] bg-brand-blue px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-purple disabled:opacity-50">
            {saving ? 'Cadastrando...' : 'Cadastrar'}
          </button>
        </form>
      )}

      {!metaConfigured && canCreate && (
        <p className="rounded-[9px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
          A integração Meta ainda não está completa no servidor. Confira META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no EasyPanel.
        </p>
      )}
      {notice && <p className="rounded-[9px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="rounded-[9px] border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">{error}</p>}

      <div className="overflow-hidden rounded-[12px] border border-brand-border bg-white">
        {loading ? (
          <p className="px-4 py-6 text-sm text-slate-500">Carregando clientes...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b border-brand-border bg-[#fafbfa] text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                <tr><th className="px-4 py-3">Nome</th><th className="px-3 py-3">Empresa</th><th className="px-3 py-3">Segmento</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Meta Ads</th><th className="px-4 py-3 text-right">Ação</th></tr>
              </thead>
              <tbody>
                {rows.map((client) => {
                  const meta = metaStatuses[String(client.id)];
                  return (
                    <tr key={String(client.id)} className="border-b border-[#edf0ed] last:border-b-0 hover:bg-[#fbfcfb]">
                      <td className="px-4 py-3.5 font-semibold text-[#1d2b23]">{client.name}</td>
                      <td className="px-3 text-slate-600">{client.companyName || '-'}</td>
                      <td className="px-3 text-slate-600">{client.segment || '-'}</td>
                      <td className="px-3 text-slate-600">{client.status || '-'}</td>
                      <td className="px-3">
                        {meta?.connected ? (
                          <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                            Conectado · {meta.accountCount} conta{meta.accountCount === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">Não conectado</span>
                        )}
                      </td>
                      <td className="px-4 text-right">
                        {canCreate ? (
                          <button
                            type="button"
                            onClick={() => { void connectMeta(String(client.id)); }}
                            disabled={!metaConfigured || connectingId === String(client.id)}
                            className="rounded-[8px] border border-[#cad7ce] bg-white px-3 py-2 text-xs font-bold text-brand-blue transition-colors hover:bg-[#f0f5f1] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {connectingId === String(client.id) ? 'Conectando...' : meta?.connected ? 'Reconectar Meta' : 'Conectar Meta'}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Somente administrador</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !rows.length && !error && <p className="px-4 py-6 text-sm text-slate-500">Nenhum cliente encontrado para este acesso.</p>}
      </div>
    </div>
  );
}
