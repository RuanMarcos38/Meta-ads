import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
  const [disconnectingId, setDisconnectingId] = useState('');
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
      setNotice('Cliente cadastrado com sucesso.');
      await load();
    } catch {
      setError('O cliente não foi cadastrado. Verifique os dados e tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  async function connectMeta(clientId: string) {
    if (!canCreate || !metaConfigured) return;

    setConnectingId(clientId);
    setError('');
    setNotice('Aguardando autorização da Meta...');

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
              ? 'Não foi possível concluir a conexão com a Meta. Tente novamente em alguns instantes.'
              : 'A autorização foi encerrada antes da conclusão.');
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
            setNotice('Meta Ads conectado com sucesso. A sincronização dos dados será atualizada pelo sistema.');
            await load();
          }
        } catch {
          // O polling é auxiliar. A autorização permanece na janela da Meta.
        }
      }, 2500);
    } catch {
      popup?.close();
      setConnectingId('');
      setNotice('');
      setError('Não foi possível iniciar a conexão com a Meta. Tente novamente.');
    }
  }

  async function disconnectMeta(clientId: string, clientName: string) {
    if (!canCreate) return;

    const confirmed = window.confirm(
      `Desconectar a Meta Ads de ${clientName}? O histórico já sincronizado será preservado.`,
    );
    if (!confirmed) return;

    setDisconnectingId(clientId);
    setError('');
    setNotice('');

    try {
      await api.post('/meta/disconnect', { clientId });
      setNotice('Meta Ads desconectado com sucesso. O histórico sincronizado foi preservado.');
      await load();
    } catch {
      setError('Não foi possível desconectar a Meta Ads. Tente novamente.');
    } finally {
      setDisconnectingId('');
    }
  }

  if (!canView) {
    return <p className="rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-amber-800">Seu perfil não possui acesso ao cadastro de clientes.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Operações</p>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#17231d]">Clientes</h1>
          <p className="mt-1.5 text-sm text-slate-500">Gerencie seus clientes e conecte as contas Meta Ads de cada operação.</p>
        </div>
        <button
          onClick={() => { setLoading(true); void load(); }}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[9px] border border-brand-border bg-white px-3.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-[#f5f7f5]"
        >
          <RefreshCw size={15} />
          Atualizar
        </button>
      </div>

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
          <button disabled={saving} className="h-11 rounded-[9px] bg-brand-blue px-5 text-sm font-bold text-white transition-colors hover:bg-brand-purple disabled:opacity-50">
            {saving ? 'Cadastrando...' : 'Cadastrar'}
          </button>
        </form>
      )}

      {notice && <p className="rounded-[9px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="rounded-[9px] border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">{error}</p>}

      <div className="overflow-hidden rounded-[12px] border border-brand-border bg-white">
        {loading ? (
          <p className="px-4 py-6 text-sm text-slate-500">Carregando clientes...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-brand-border bg-[#fafbfa] text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-3 py-3">Empresa</th>
                  <th className="px-3 py-3">Segmento</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Meta Ads</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((client) => {
                  const meta = metaStatuses[String(client.id)];
                  const clientId = String(client.id);
                  const busy = connectingId === clientId || disconnectingId === clientId;

                  return (
                    <tr key={clientId} className="border-b border-[#edf0ed] last:border-b-0 hover:bg-[#fbfcfb]">
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
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => { void connectMeta(clientId); }}
                              disabled={!metaConfigured || busy}
                              className="rounded-[8px] border border-[#cad7ce] bg-white px-3 py-2 text-xs font-bold text-brand-blue transition-colors hover:bg-[#f0f5f1] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {connectingId === clientId ? 'Conectando...' : meta?.connected ? 'Reconectar Meta' : 'Conectar Meta'}
                            </button>

                            {meta?.connected && (
                              <button
                                type="button"
                                onClick={() => { void disconnectMeta(clientId, String(client.name || 'este cliente')); }}
                                disabled={busy}
                                className="rounded-[8px] border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {disconnectingId === clientId ? 'Desconectando...' : 'Desconectar'}
                              </button>
                            )}
                          </div>
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
