import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../store';

type MetaClientStatus = {
  clientId: string;
  connected: boolean;
  accountCount: number;
  tokenExpiresAt?: string | null;
  connectedAt?: string | null;
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    if (!canView) {
      setLoading(false);
      return;
    }

    setError('');
    try {
      const [clientsResponse, metaResponse] = await Promise.all([
        api.get('/clients'),
        api.get('/meta/status').catch(() => null),
      ]);
      setRows(Array.isArray(clientsResponse.data.data) ? clientsResponse.data.data : []);

      const metaData = metaResponse?.data?.data;
      if (metaData) {
        setMetaConfigured(Boolean(metaData.configured));
        const entries = Array.isArray(metaData.clients) ? metaData.clients : [];
        setMetaStatuses(Object.fromEntries(entries.map((item: MetaClientStatus) => [item.clientId, item])));
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
    setNotice('');

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
        const timedOut = Date.now() - startedAt > 180_000;
        if (popup.closed || timedOut) {
          window.clearInterval(poll);
          setConnectingId('');
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
      setError('Não foi possível iniciar a conexão com a Meta. Confira as variáveis do app no EasyPanel.');
    }
  }

  if (!canView) {
    return <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300">Seu perfil não possui acesso ao cadastro de clientes.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="mt-1 text-sm text-slate-500">Cadastre o cliente e conecte as contas Meta Ads sem sair da operação.</p>
        </div>
        <button onClick={() => { setLoading(true); void load(); }} className="px-3 py-2 rounded-lg border border-brand-border text-sm text-slate-600 hover:bg-black/5">Atualizar</button>
      </div>

      {canCreate && (
        <form onSubmit={create} className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome do cliente"
            minLength={2}
            required
            className="flex-1 px-3 py-2 rounded-lg bg-white border border-brand-border outline-none focus:border-brand-blue"
          />
          <button disabled={saving} className="px-4 py-2 rounded-lg bg-brand-blue text-white text-sm font-medium disabled:opacity-50">
            {saving ? 'Cadastrando...' : 'Cadastrar'}
          </button>
        </form>
      )}

      {!metaConfigured && canCreate && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          A integração Meta ainda não está completa no servidor. Confira META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no EasyPanel.
        </p>
      )}
      {notice && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}

      <div className="bg-white border border-brand-border rounded-xl p-4">
        {loading ? (
          <p className="text-sm text-slate-500">Carregando clientes...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="text-slate-500 text-left">
                <tr><th className="py-2">Nome</th><th>Empresa</th><th>Segmento</th><th>Status</th><th>Meta Ads</th><th className="text-right">Ação</th></tr>
              </thead>
              <tbody>
                {rows.map((client) => {
                  const meta = metaStatuses[String(client.id)];
                  return (
                    <tr key={String(client.id)} className="border-t border-brand-border">
                      <td className="py-3 font-medium text-slate-900">{client.name}</td>
                      <td>{client.companyName || '-'}</td>
                      <td>{client.segment || '-'}</td>
                      <td>{client.status || '-'}</td>
                      <td>
                        {meta?.connected ? (
                          <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            Conectado · {meta.accountCount} conta{meta.accountCount === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Não conectado</span>
                        )}
                      </td>
                      <td className="text-right">
                        {canCreate ? (
                          <button
                            type="button"
                            onClick={() => { void connectMeta(String(client.id)); }}
                            disabled={!metaConfigured || connectingId === String(client.id)}
                            className="rounded-lg border border-brand-border px-3 py-2 text-xs font-bold text-brand-blue transition hover:bg-[#eef4eb] disabled:cursor-not-allowed disabled:opacity-50"
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
        {!loading && !rows.length && !error && <p className="py-5 text-sm text-slate-500">Nenhum cliente encontrado para este acesso.</p>}
      </div>
    </div>
  );
}
