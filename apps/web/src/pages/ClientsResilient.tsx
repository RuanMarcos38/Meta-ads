import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Link2,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../store';

type ClientRow = {
  id: string;
  name: string;
  companyName?: string | null;
  segment?: string | null;
  status?: string | null;
  metaBusinessId?: string | null;
  metaBusinessName?: string | null;
  metaAdminEmail?: string | null;
};

type MetaClientStatus = {
  clientId: string;
  connected: boolean;
  accountCount: number;
  tokenExpiresAt?: string | null;
};

type MetaAccount = {
  id: string;
  clientId: string;
  accountId: string;
  name?: string | null;
  currency?: string | null;
  businessId?: string | null;
  businessName?: string | null;
  accountStatus?: number | null;
  isActive: boolean;
  isAssigned: boolean;
};

type TenantUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  clientId?: string | null;
  businessId?: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
};

type BusinessUser = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
};

type BusinessDirectoryItem = {
  businessId: string;
  businessName: string;
  users: BusinessUser[];
  admins: BusinessUser[];
  pendingUsers: BusinessUser[];
  adAccounts: Array<{
    accountId: string;
    name?: string;
    currency?: string;
    accountStatus?: number | null;
  }>;
  adminEmails: string[];
  preferredAdminEmail?: string | null;
};

function apiMessage(error: any, fallback: string) {
  return error?.response?.data?.error?.message
    || error?.response?.data?.message
    || fallback;
}

function isDirectoryUnavailable(error: any) {
  const status = Number(error?.response?.status || 0);
  const code = String(error?.response?.data?.error?.code || '');
  return [404, 405, 409, 500, 501, 502, 503].includes(status)
    || ['META_BUSINESS_DIRECTORY_ERROR', 'META_CONNECTION_REQUIRED'].includes(code)
    || !error?.response;
}

export default function ClientsResilient() {
  const user = useAuth((state) => state.user);
  const canView = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const canAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');

  const [rows, setRows] = useState<ClientRow[]>([]);
  const [metaStatuses, setMetaStatuses] = useState<Record<string, MetaClientStatus>>({});
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [directories, setDirectories] = useState<Record<string, BusinessDirectoryItem[]>>({});
  const [compatClients, setCompatClients] = useState<Record<string, boolean>>({});

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [connectingId, setConnectingId] = useState('');
  const [disconnectingId, setDisconnectingId] = useState('');
  const [expandedClientId, setExpandedClientId] = useState('');
  const [configuringClientId, setConfiguringClientId] = useState('');
  const [directoryLoadingId, setDirectoryLoadingId] = useState('');
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [selectedAdminEmail, setSelectedAdminEmail] = useState('');
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [assigningAccountId, setAssigningAccountId] = useState('');

  const [accessName, setAccessName] = useState('');
  const [accessEmail, setAccessEmail] = useState('');
  const [accessPassword, setAccessPassword] = useState('');
  const [accessRole, setAccessRole] = useState<'CLIENT' | 'MANAGER'>('CLIENT');
  const [savingAccess, setSavingAccess] = useState(false);
  const [changingUserId, setChangingUserId] = useState('');

  async function load(showLoader = false) {
    if (!canView) {
      setLoading(false);
      return;
    }

    if (showLoader) setLoading(true);
    try {
      const [clientsResponse, metaResponse, contextResponse, usersResponse] = await Promise.all([
        api.get('/clients'),
        api.get('/meta/status').catch(() => null),
        canAdmin ? api.get('/dashboard/context').catch(() => null) : Promise.resolve(null),
        canAdmin ? api.get('/access/users-bm').catch(() => null) : Promise.resolve(null),
      ]);

      const clients = Array.isArray(clientsResponse.data?.data)
        ? clientsResponse.data.data as ClientRow[]
        : [];
      setRows(clients);

      const statuses = metaResponse?.data?.data?.clients;
      setMetaStatuses(Object.fromEntries(
        (Array.isArray(statuses) ? statuses : []).map((item: MetaClientStatus) => [item.clientId, item]),
      ));

      if (canAdmin) {
        const availableAccounts = contextResponse?.data?.data?.accounts;
        setAccounts(Array.isArray(availableAccounts) ? availableAccounts : []);
        setUsers(Array.isArray(usersResponse?.data?.data) ? usersResponse.data.data : []);
      }
    } catch (requestError: any) {
      setError(apiMessage(requestError, 'Não foi possível carregar as empresas deste acesso.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [canView, canAdmin]);

  const accountsByClient = useMemo(() => {
    const map = new Map<string, MetaAccount[]>();
    for (const account of accounts) {
      const current = map.get(account.clientId) || [];
      current.push(account);
      map.set(account.clientId, current);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(b.isAssigned) - Number(a.isAssigned)
        || String(a.businessName || '').localeCompare(String(b.businessName || ''))
        || String(a.name || a.accountId).localeCompare(String(b.name || b.accountId)));
    }
    return map;
  }, [accounts]);

  const usersByClient = useMemo(() => {
    const map = new Map<string, TenantUser[]>();
    for (const item of users) {
      if (!item.clientId) continue;
      const current = map.get(item.clientId) || [];
      current.push(item);
      map.set(item.clientId, current);
    }
    return map;
  }, [users]);

  async function createClient(event: React.FormEvent) {
    event.preventDefault();
    if (!canAdmin || !name.trim()) return;

    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.post('/clients', { name: name.trim() });
      setName('');
      setNotice('Empresa cadastrada. Conecte a Meta e autorize as contas corretas desta empresa.');
      await load();
    } catch (requestError: any) {
      setError(apiMessage(requestError, 'A empresa não foi cadastrada.'));
    } finally {
      setSaving(false);
    }
  }

  async function connectMeta(clientId: string) {
    if (!canAdmin) return;
    setConnectingId(clientId);
    setError('');
    setNotice('Aguardando autorização da Meta...');
    const popup = window.open('about:blank', 'gestao-ads-meta-oauth', 'width=760,height=860');

    try {
      const response = await api.get('/meta/oauth/start-management', { params: { clientId } });
      const authUrl = response.data?.data?.authUrl as string | undefined;
      if (!authUrl) throw new Error('URL de autorização ausente.');
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
          await load();
          if (timedOut) {
            setNotice('');
            setError('A autorização da Meta excedeu o tempo de espera. Tente novamente.');
          }
          return;
        }

        const statusResponse = await api.get('/meta/status', { params: { clientId } }).catch(() => null);
        const statuses = statusResponse?.data?.data?.clients;
        const connected = Array.isArray(statuses)
          && statuses.some((item: MetaClientStatus) => item.clientId === clientId && item.connected);

        if (connected) {
          popup.close();
          window.clearInterval(poll);
          setConnectingId('');
          await load();
          setNotice('Meta conectada. Selecione a BM ou abra Contas Meta para liberar as métricas.');
        }
      }, 2500);
    } catch (requestError: any) {
      popup?.close();
      setConnectingId('');
      setNotice('');
      setError(apiMessage(requestError, 'Não foi possível iniciar a conexão com a Meta.'));
    }
  }

  async function disconnectMeta(clientId: string, clientName: string) {
    if (!canAdmin) return;
    if (!window.confirm(`Desconectar a Meta Ads de ${clientName}? O histórico sincronizado será preservado.`)) return;

    setDisconnectingId(clientId);
    setError('');
    setNotice('');
    try {
      await api.post('/meta/client-disconnect', { clientId });
      setNotice('Meta desconectada. O histórico da empresa foi preservado.');
      await load();
    } catch (requestError: any) {
      setError(apiMessage(requestError, 'Não foi possível desconectar a Meta Ads.'));
    } finally {
      setDisconnectingId('');
    }
  }

  async function openBusinessSelector(clientId: string) {
    if (!canAdmin) return;
    const client = rows.find((item) => item.id === clientId);
    setConfiguringClientId(clientId);
    setDirectoryLoadingId(clientId);
    setError('');
    setNotice('');

    try {
      const response = await api.get('/meta/business-directory', { params: { clientId } });
      const businesses = Array.isArray(response.data?.data?.businesses)
        ? response.data.data.businesses as BusinessDirectoryItem[]
        : [];

      if (!businesses.length) {
        setConfiguringClientId('');
        setCompatClients((current) => ({ ...current, [clientId]: true }));
        setExpandedClientId(clientId);
        setNotice('A Meta não retornou a lista de BMs. As contas Meta foram abertas em modo compatível para não bloquear as métricas.');
        return;
      }

      setDirectories((current) => ({ ...current, [clientId]: businesses }));
      setCompatClients((current) => ({ ...current, [clientId]: false }));
      const initial = businesses.find((item) => item.businessId === client?.metaBusinessId) || businesses[0];
      setSelectedBusinessId(initial?.businessId || '');
      setSelectedAdminEmail(
        client?.metaAdminEmail
        || initial?.preferredAdminEmail
        || initial?.adminEmails?.[0]
        || '',
      );
    } catch (requestError: any) {
      if (isDirectoryUnavailable(requestError)) {
        setConfiguringClientId('');
        setCompatClients((current) => ({ ...current, [clientId]: true }));
        setExpandedClientId(clientId);
        setNotice('Diretório de BMs indisponível no backend atual. As contas Meta continuam liberadas para configuração e sincronização das métricas.');
      } else {
        setConfiguringClientId('');
        setError(apiMessage(requestError, 'Não foi possível carregar as Business Managers da Meta.'));
      }
    } finally {
      setDirectoryLoadingId('');
    }
  }

  function selectBusiness(clientId: string, businessId: string) {
    setSelectedBusinessId(businessId);
    const business = (directories[clientId] || []).find((item) => item.businessId === businessId);
    setSelectedAdminEmail(business?.preferredAdminEmail || business?.adminEmails?.[0] || '');
  }

  async function linkBusiness(client: ClientRow) {
    if (!canAdmin || !selectedBusinessId) return;
    setSavingBusiness(true);
    setError('');
    setNotice('');

    try {
      await api.post(`/clients/${client.id}/business-from-meta`, {
        businessId: selectedBusinessId,
        adminEmail: selectedAdminEmail.trim(),
      });
      setConfiguringClientId('');
      setCompatClients((current) => ({ ...current, [client.id]: false }));
      setExpandedClientId(client.id);
      setNotice(`BM vinculada à empresa ${client.name}. Autorize as contas que devem alimentar o dashboard.`);
      await load();
    } catch (requestError: any) {
      if (isDirectoryUnavailable(requestError)) {
        setConfiguringClientId('');
        setCompatClients((current) => ({ ...current, [client.id]: true }));
        setExpandedClientId(client.id);
        setNotice('A vinculação automática da BM não está disponível no backend atual. Use as contas Meta abaixo; as métricas continuam funcionando normalmente.');
      } else {
        setError(apiMessage(requestError, 'Não foi possível vincular a Business Manager.'));
      }
    } finally {
      setSavingBusiness(false);
    }
  }

  async function syncClient(clientId: string) {
    try {
      await api.post('/dashboard/scoped/sync', { clientId });
      return true;
    } catch {
      return false;
    }
  }

  async function toggleAccountAssignment(account: MetaAccount, client: ClientRow) {
    if (!canAdmin) return;

    if (!account.isAssigned
      && client.metaBusinessId
      && account.businessId
      && account.businessId !== client.metaBusinessId) {
      setError(`A conta ${account.name || account.accountId} pertence a outra BM e não será vinculada a esta empresa.`);
      return;
    }

    setAssigningAccountId(account.id);
    setError('');
    setNotice('');
    const nextAssigned = !account.isAssigned;

    try {
      let saved = false;
      const canUseBusinessRoute = Boolean(
        client.metaBusinessId
        && (!account.businessId || account.businessId === client.metaBusinessId),
      );

      if (canUseBusinessRoute) {
        try {
          await api.patch(`/meta/client-accounts/${account.id}/business-assignment`, { isAssigned: nextAssigned });
          saved = true;
        } catch (requestError: any) {
          const status = Number(requestError?.response?.status || 0);
          const code = String(requestError?.response?.data?.error?.code || '');
          const canFallback = [404, 405, 501].includes(status)
            || ['BM_REQUIRED'].includes(code);
          if (!canFallback) throw requestError;
        }
      }

      if (!saved) {
        await api.patch(`/meta/client-accounts/${account.id}/assignment`, { isAssigned: nextAssigned });
      }

      if (nextAssigned) {
        const synced = await syncClient(client.id);
        setNotice(synced
          ? 'Conta autorizada e métricas sincronizadas. Abra o Dashboard para visualizar os números.'
          : 'Conta autorizada. Abra o Dashboard e clique em “Atualizar agora” para buscar as métricas.');
      } else {
        setNotice('Conta removida do dashboard desta empresa. O histórico já sincronizado foi preservado.');
      }

      await load();
    } catch (requestError: any) {
      setError(apiMessage(requestError, 'Não foi possível alterar a autorização desta conta Meta.'));
    } finally {
      setAssigningAccountId('');
    }
  }

  async function createAccess(event: React.FormEvent, clientId: string) {
    event.preventDefault();
    if (!canAdmin) return;

    setSavingAccess(true);
    setError('');
    setNotice('');
    try {
      await api.post('/access/users-bm', {
        name: accessName.trim(),
        email: accessEmail.trim(),
        password: accessPassword,
        clientId,
        role: accessRole,
      });
      setAccessName('');
      setAccessEmail('');
      setAccessPassword('');
      setNotice('Usuário criado e vinculado ao escopo desta empresa.');
      await load();
    } catch (requestError: any) {
      setError(apiMessage(requestError, 'Não foi possível criar o acesso.'));
    } finally {
      setSavingAccess(false);
    }
  }

  async function toggleUser(target: TenantUser) {
    if (!canAdmin) return;
    setChangingUserId(target.id);
    setError('');
    setNotice('');
    try {
      await api.patch(`/access/users/${target.id}/status`, { isActive: !target.isActive });
      setNotice(target.isActive ? 'Acesso desativado.' : 'Acesso ativado.');
      await load();
    } catch (requestError: any) {
      setError(apiMessage(requestError, 'Não foi possível alterar o acesso.'));
    } finally {
      setChangingUserId('');
    }
  }

  if (!canView) {
    return <p className="rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-amber-800">Seu perfil não possui acesso à gestão de empresas.</p>;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Operações</p>
          <h1 className="text-[26px] font-bold tracking-[-0.025em] text-[#16231b]">Empresas</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-500">
            Cada empresa possui contas Meta autorizadas e usuários próprios. A BM é aplicada quando a Meta disponibiliza essa informação.
          </p>
        </div>
        <button onClick={() => { setError(''); setNotice(''); void load(true); }} className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#d9e0db] bg-white px-3.5 text-sm font-semibold text-slate-600 hover:bg-[#f7f9f7]">
          <RefreshCw size={14} /> Atualizar
        </button>
      </header>

      {canAdmin && (
        <form onSubmit={createClient} className="flex flex-col gap-2 rounded-[10px] border border-[#dfe5e1] bg-white p-4 sm:flex-row">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da nova empresa" minLength={2} required className="h-10 flex-1 rounded-[7px] border border-[#d9e0db] bg-white px-3.5 text-sm outline-none focus:border-[#8db49f]" />
          <button disabled={saving} className="h-10 rounded-[7px] bg-[#176846] px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Cadastrando...' : 'Cadastrar empresa'}</button>
        </form>
      )}

      {notice && <p className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="rounded-[8px] border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">{error}</p>}

      {loading ? (
        <section className="rounded-[10px] border border-[#dfe5e1] bg-white px-5 py-8 text-sm text-slate-500">Carregando empresas...</section>
      ) : (
        <section className="space-y-3">
          {rows.map((client) => {
            const meta = metaStatuses[client.id];
            const clientAccounts = accountsByClient.get(client.id) || [];
            const activeAccounts = clientAccounts.filter((account) => account.isActive);
            const strictBusinessAccounts = client.metaBusinessId
              ? activeAccounts.filter((account) => account.businessId === client.metaBusinessId)
              : [];
            const visibleAccounts = strictBusinessAccounts.length ? strictBusinessAccounts : activeAccounts;
            const assignedAccounts = visibleAccounts.filter((account) => account.isAssigned);
            const clientUsers = usersByClient.get(client.id) || [];
            const expanded = expandedClientId === client.id;
            const configuring = configuringClientId === client.id;
            const businesses = directories[client.id] || [];
            const selectedBusiness = businesses.find((item) => item.businessId === selectedBusinessId);
            const busy = connectingId === client.id || disconnectingId === client.id;
            const compatibilityMode = Boolean(
              compatClients[client.id]
              || (!client.metaBusinessId && activeAccounts.length)
              || (client.metaBusinessId && strictBusinessAccounts.length === 0 && activeAccounts.length),
            );

            return (
              <article key={client.id} className="overflow-hidden rounded-[11px] border border-[#dce3de] bg-white">
                <div className="px-5 py-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[16px] font-bold tracking-[-0.01em] text-[#17251c]">{client.name}</h2>
                        <span className="text-[10px] font-medium text-slate-400">ID {client.id}</span>
                        <span className={`rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold ${client.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{client.status === 'active' ? 'Ativa' : client.status || 'Sem status'}</span>
                      </div>
                    </div>

                    {canAdmin && (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => { void openBusinessSelector(client.id); }} disabled={!meta?.connected || directoryLoadingId === client.id} className="rounded-[7px] border border-[#cfd9d2] px-3 py-2 text-xs font-semibold text-[#176846] hover:bg-[#f4f8f5] disabled:opacity-45">
                          {directoryLoadingId === client.id ? 'Buscando BM...' : client.metaBusinessId ? 'Trocar BM' : 'Selecionar BM'}
                        </button>
                        {meta?.connected && (
                          <button type="button" onClick={() => setExpandedClientId(expanded ? '' : client.id)} className="rounded-[7px] border border-[#cfd9d2] px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-[#f7f9f7]">
                            {expanded ? 'Fechar contas' : 'Contas Meta'}
                          </button>
                        )}
                        <button type="button" onClick={() => { void connectMeta(client.id); }} disabled={busy} className="rounded-[7px] border border-[#cfd9d2] px-3 py-2 text-xs font-semibold text-[#176846] hover:bg-[#f4f8f5] disabled:opacity-50">
                          {connectingId === client.id ? 'Conectando...' : meta?.connected ? 'Reconectar Meta' : 'Conectar Meta'}
                        </button>
                        {meta?.connected && (
                          <button type="button" onClick={() => { void disconnectMeta(client.id, client.name); }} disabled={busy} className="rounded-[7px] border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                            {disconnectingId === client.id ? 'Desconectando...' : 'Desconectar'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-[#edf0ee] pt-4 sm:grid-cols-2 xl:grid-cols-5">
                    <div>
                      <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Business Manager</dt>
                      <dd className="mt-1 truncate text-[13px] font-semibold text-[#1b2921]">{client.metaBusinessName || (compatibilityMode ? 'Aguardando Meta' : 'Não vinculada')}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">ID da BM</dt>
                      <dd className="mt-1 truncate text-[12px] font-medium text-slate-600">{client.metaBusinessId || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">E-mail Meta</dt>
                      <dd className="mt-1 truncate text-[12px] font-medium text-slate-600">{client.metaAdminEmail || 'Não retornado'}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Contas autorizadas</dt>
                      <dd className="mt-1 text-[13px] font-semibold text-[#1b2921]">{assignedAccounts.length} de {visibleAccounts.length}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">Usuários</dt>
                      <dd className="mt-1 text-[13px] font-semibold text-[#1b2921]">{clientUsers.length}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0ee] pt-3">
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                      <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${meta?.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />{meta?.connected ? 'Meta conectada' : 'Meta não conectada'}</span>
                      {compatibilityMode && <span className="rounded-[5px] bg-amber-50 px-2 py-1 font-medium text-amber-700">BM não bloqueia métricas</span>}
                    </div>
                    {canAdmin && meta?.connected && (
                      <button type="button" onClick={() => setExpandedClientId(expanded ? '' : client.id)} className="inline-flex items-center gap-2 rounded-[7px] border border-[#d7ded9] px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-[#f7f9f7]">
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {expanded ? 'Fechar' : 'Contas e usuários'}
                      </button>
                    )}
                  </div>
                </div>

                {configuring && canAdmin && (
                  <section className="border-t border-[#e8ece9] bg-[#f8faf8] px-5 py-4">
                    <div className="mb-4 flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#17251c]"><Building2 size={15} /> Business Manager da empresa</div>
                        <p className="mt-1 text-[11px] leading-4 text-slate-500">As BMs e e-mails são carregados da conta Meta autorizada quando o backend disponibiliza essa consulta.</p>
                      </div>
                      <button type="button" onClick={() => setConfiguringClientId('')} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Fechar</button>
                    </div>

                    {directoryLoadingId === client.id ? (
                      <p className="py-5 text-sm text-slate-500">Buscando Business Managers na Meta...</p>
                    ) : (
                      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr_auto] lg:items-end">
                        <label className="text-xs font-semibold text-slate-600">Business Manager
                          <select value={selectedBusinessId} onChange={(event) => selectBusiness(client.id, event.target.value)} className="mt-1.5 h-10 w-full rounded-[7px] border border-[#d8e0da] bg-white px-3 text-sm outline-none focus:border-[#8db49f]">
                            <option value="">Selecione uma BM</option>
                            {businesses.map((business) => (
                              <option key={business.businessId} value={business.businessId}>
                                {business.businessName} · ID {business.businessId} · {business.adAccounts.length} conta{business.adAccounts.length === 1 ? '' : 's'}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-xs font-semibold text-slate-600">E-mail vinculado / administrador
                          {selectedBusiness?.adminEmails?.length ? (
                            <select value={selectedAdminEmail} onChange={(event) => setSelectedAdminEmail(event.target.value)} className="mt-1.5 h-10 w-full rounded-[7px] border border-[#d8e0da] bg-white px-3 text-sm outline-none focus:border-[#8db49f]">
                              <option value="">Sem e-mail selecionado</option>
                              {selectedBusiness.adminEmails.map((email) => <option key={email} value={email}>{email}</option>)}
                            </select>
                          ) : (
                            <input type="email" value={selectedAdminEmail} onChange={(event) => setSelectedAdminEmail(event.target.value)} placeholder="Meta não retornou e-mail" className="mt-1.5 h-10 w-full rounded-[7px] border border-[#d8e0da] bg-white px-3 text-sm outline-none focus:border-[#8db49f]" />
                          )}
                        </label>

                        <button type="button" onClick={() => { void linkBusiness(client); }} disabled={!selectedBusinessId || savingBusiness} className="h-10 rounded-[7px] bg-[#176846] px-4 text-xs font-semibold text-white disabled:opacity-50">
                          {savingBusiness ? 'Salvando...' : 'Vincular BM'}
                        </button>
                      </div>
                    )}
                  </section>
                )}

                {expanded && canAdmin && (
                  <div className="grid border-t border-[#e8ece9] xl:grid-cols-[1.15fr_0.85fr]">
                    <section className="border-b border-[#e8ece9] xl:border-b-0 xl:border-r">
                      <div className="px-5 py-3.5">
                        <div className="flex items-center gap-2"><Link2 size={14} className="text-[#176846]" /><h3 className="text-sm font-semibold text-[#17251c]">{strictBusinessAccounts.length ? 'Contas desta BM' : 'Contas Meta disponíveis'}</h3></div>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {strictBusinessAccounts.length
                            ? `Somente contas confirmadas na BM ${client.metaBusinessName || client.metaBusinessId} aparecem aqui.`
                            : 'Autorize somente as contas que pertencem a esta empresa. Isso libera a sincronização das métricas no Dashboard.'}
                        </p>
                      </div>

                      <div className="max-h-[420px] overflow-auto border-t border-[#eef1ef]">
                        {visibleAccounts.map((account) => (
                          <div key={account.id} className="flex flex-col gap-2 border-b border-[#eef1ef] px-5 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-[#1a2820]">{account.name || `Conta ${account.accountId}`}</p>
                                {account.isAssigned && <span className="rounded-[5px] bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">Autorizada</span>}
                                {account.businessName && <span className="rounded-[5px] bg-slate-50 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">{account.businessName}</span>}
                              </div>
                              <p className="mt-1 text-[11px] text-slate-400">ID {account.accountId} · {account.currency || '-'}</p>
                            </div>
                            <button type="button" onClick={() => { void toggleAccountAssignment(account, client); }} disabled={assigningAccountId === account.id} className={`shrink-0 rounded-[7px] border px-3 py-1.5 text-xs font-semibold disabled:opacity-45 ${account.isAssigned ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-[#d5ddd7] bg-white text-slate-600 hover:bg-[#f7f9f7]'}`}>
                              {assigningAccountId === account.id ? 'Sincronizando...' : account.isAssigned ? 'Remover' : 'Autorizar e sincronizar'}
                            </button>
                          </div>
                        ))}
                        {!visibleAccounts.length && (
                          <p className="px-5 py-6 text-sm text-slate-500">
                            {meta?.connected
                              ? 'A conexão está ativa, mas nenhuma conta de anúncio foi retornada. Use Reconectar Meta para renovar as permissões.'
                              : 'Conecte a Meta nesta empresa para carregar as contas de anúncio.'}
                          </p>
                        )}
                      </div>
                    </section>

                    <section>
                      <div className="px-5 py-3.5">
                        <div className="flex items-center gap-2"><Users size={14} className="text-[#176846]" /><h3 className="text-sm font-semibold text-[#17251c]">Usuários desta empresa</h3></div>
                        <p className="mt-1 text-[11px] text-slate-400">O login é feito apenas com e-mail e senha. Cada acesso permanece isolado por empresa.</p>
                      </div>

                      <div className="border-t border-[#eef1ef]">
                        {clientUsers.map((target) => (
                          <div key={target.id} className="flex items-center justify-between gap-3 border-b border-[#eef1ef] px-5 py-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[#1a2820]">{target.name}</p>
                              <p className="mt-0.5 truncate text-[11px] text-slate-400">{target.email} · {target.role === 'MANAGER' ? 'Gestor' : 'Cliente'}</p>
                            </div>
                            <button type="button" onClick={() => { void toggleUser(target); }} disabled={changingUserId === target.id} className={`rounded-[7px] border px-2.5 py-1.5 text-[11px] font-semibold ${target.isActive ? 'border-red-100 text-red-600' : 'border-emerald-200 text-emerald-700'}`}>
                              {changingUserId === target.id ? 'Salvando...' : target.isActive ? 'Desativar' : 'Ativar'}
                            </button>
                          </div>
                        ))}
                        {!clientUsers.length && <p className="px-5 py-4 text-sm text-slate-500">Nenhum usuário cadastrado para esta empresa.</p>}
                      </div>

                      <form onSubmit={(event) => { void createAccess(event, client.id); }} className="border-t border-[#eef1ef] bg-[#fafbfa] p-5">
                        <div className="mb-3 flex items-center gap-2"><UserPlus size={14} className="text-[#176846]" /><h4 className="text-xs font-semibold text-slate-700">Novo acesso</h4></div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input value={accessName} onChange={(event) => setAccessName(event.target.value)} required minLength={2} placeholder="Nome" className="h-9 rounded-[7px] border border-[#d8e0da] bg-white px-3 text-xs outline-none" />
                          <input value={accessEmail} onChange={(event) => setAccessEmail(event.target.value)} required type="email" placeholder="E-mail" className="h-9 rounded-[7px] border border-[#d8e0da] bg-white px-3 text-xs outline-none" />
                          <input value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} required minLength={12} type="password" placeholder="Senha (mín. 12 caracteres)" className="h-9 rounded-[7px] border border-[#d8e0da] bg-white px-3 text-xs outline-none" />
                          <select value={accessRole} onChange={(event) => setAccessRole(event.target.value as 'CLIENT' | 'MANAGER')} className="h-9 rounded-[7px] border border-[#d8e0da] bg-white px-3 text-xs outline-none">
                            <option value="CLIENT">Cliente</option>
                            <option value="MANAGER">Gestor</option>
                          </select>
                        </div>
                        <button disabled={savingAccess || !client.metaBusinessId} className="mt-3 inline-flex h-9 items-center gap-2 rounded-[7px] bg-[#176846] px-4 text-xs font-semibold text-white disabled:opacity-50">
                          <ShieldCheck size={13} /> {savingAccess ? 'Criando...' : 'Criar acesso'}
                        </button>
                        {!client.metaBusinessId && <p className="mt-2 text-[10px] text-slate-400">Para criar acessos de cliente, a BM precisa estar vinculada. Isso não impede a visualização das métricas pelo administrador.</p>}
                      </form>
                    </section>
                  </div>
                )}
              </article>
            );
          })}

          {!rows.length && <div className="rounded-[10px] border border-[#dfe5e1] bg-white px-5 py-8 text-center text-sm text-slate-500">Nenhuma empresa cadastrada.</div>}
        </section>
      )}

      {canAdmin && (
        <div className="flex items-start gap-2 rounded-[9px] border border-[#e1e6e2] bg-[#f8faf8] px-4 py-3 text-[11px] leading-5 text-slate-500">
          <Mail size={14} className="mt-0.5 shrink-0 text-[#176846]" />
          <span>A consulta de BM e e-mail é complementar. Se a Meta ou o backend não devolverem esses dados, as contas de anúncio e as métricas continuam operando sem serem bloqueadas.</span>
        </div>
      )}
    </div>
  );
}
