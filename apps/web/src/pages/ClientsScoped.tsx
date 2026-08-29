import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  KeyRound,
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
  client?: {
    name?: string | null;
    metaBusinessId?: string | null;
    metaBusinessName?: string | null;
    metaAdminEmail?: string | null;
  } | null;
};

export default function ClientsScoped() {
  const user = useAuth((state) => state.user);
  const canView = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const canAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');

  const [rows, setRows] = useState<ClientRow[]>([]);
  const [metaStatuses, setMetaStatuses] = useState<Record<string, MetaClientStatus>>({});
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [connectingId, setConnectingId] = useState('');
  const [disconnectingId, setDisconnectingId] = useState('');
  const [assigningAccountId, setAssigningAccountId] = useState('');
  const [expandedClientId, setExpandedClientId] = useState('');
  const [editingBusinessClientId, setEditingBusinessClientId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessAdminEmail, setBusinessAdminEmail] = useState('');
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [accessName, setAccessName] = useState('');
  const [accessEmail, setAccessEmail] = useState('');
  const [accessPassword, setAccessPassword] = useState('');
  const [accessClientId, setAccessClientId] = useState('');
  const [accessRole, setAccessRole] = useState<'CLIENT' | 'MANAGER'>('CLIENT');
  const [savingAccess, setSavingAccess] = useState(false);
  const [changingUserId, setChangingUserId] = useState('');

  async function load() {
    if (!canView) {
      setLoading(false);
      return;
    }

    setError('');
    try {
      const [clientsResponse, metaResponse, contextResponse, usersResponse] = await Promise.all([
        api.get('/clients'),
        api.get('/meta/status').catch(() => null),
        canAdmin ? api.get('/dashboard/context').catch(() => null) : Promise.resolve(null),
        canAdmin ? api.get('/access/users-bm').catch(() => null) : Promise.resolve(null),
      ]);

      const clients = Array.isArray(clientsResponse.data?.data) ? clientsResponse.data.data as ClientRow[] : [];
      setRows(clients);
      setAccessClientId((current) => current || String(clients[0]?.id || ''));

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
      setError(requestError?.response?.data?.message || 'Não foi possível carregar as empresas deste acesso.');
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
    for (const current of map.values()) {
      current.sort((a, b) => Number(b.isAssigned) - Number(a.isAssigned) || String(a.name || '').localeCompare(String(b.name || '')));
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

  const selectedAccessClient = rows.find((client) => client.id === accessClientId);

  async function createClient(event: React.FormEvent) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || !canAdmin) return;

    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.post('/clients', { name: normalizedName });
      setName('');
      setNotice('Empresa cadastrada. Agora vincule a BM e o e-mail do administrador Meta.');
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'A empresa não foi cadastrada.');
    } finally {
      setSaving(false);
    }
  }

  function beginBusinessEdit(client: ClientRow) {
    setEditingBusinessClientId(client.id);
    setBusinessId(client.metaBusinessId || '');
    setBusinessName(client.metaBusinessName || '');
    setBusinessAdminEmail(client.metaAdminEmail || '');
    setExpandedClientId(client.id);
    setError('');
    setNotice('');
  }

  async function saveBusinessAccess(event: React.FormEvent, client: ClientRow) {
    event.preventDefault();
    if (!canAdmin) return;

    setSavingBusiness(true);
    setError('');
    setNotice('');
    try {
      await api.patch(`/clients/${client.id}/business-access`, {
        businessId: businessId.trim(),
        businessName: businessName.trim(),
        adminEmail: businessAdminEmail.trim().toLowerCase(),
      });
      setEditingBusinessClientId('');
      setNotice(`BM vinculada à empresa ${client.name}. Usuários e contas autorizadas foram atualizados.`);
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível vincular a Business Manager.');
    } finally {
      setSavingBusiness(false);
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
      if (!authUrl) throw new Error('URL ausente');
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
          setExpandedClientId(clientId);
          setNotice('Meta Ads conectado. Abra “Gerenciar contas” e autorize somente as contas desta empresa.');
          await load();
        }
      }, 2500);
    } catch (requestError: any) {
      popup?.close();
      setConnectingId('');
      setNotice('');
      setError(requestError?.response?.data?.message || 'Não foi possível iniciar a conexão com a Meta.');
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
      setNotice('Meta Ads desconectado. Campanhas e métricas históricas foram preservadas.');
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível desconectar a Meta Ads.');
    } finally {
      setDisconnectingId('');
    }
  }

  async function toggleAccountAssignment(account: MetaAccount) {
    if (!canAdmin) return;
    setAssigningAccountId(account.id);
    setError('');
    setNotice('');
    try {
      await api.patch(`/meta/client-accounts/${account.id}/business-assignment`, { isAssigned: !account.isAssigned });
      setNotice(account.isAssigned
        ? 'Conta removida do dashboard desta empresa. O histórico foi preservado.'
        : 'Conta vinculada à BM da empresa e liberada para o dashboard.');
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível alterar a vinculação desta conta Meta.');
    } finally {
      setAssigningAccountId('');
    }
  }

  async function createAccess(event: React.FormEvent) {
    event.preventDefault();
    if (!canAdmin || !accessClientId) return;

    setSavingAccess(true);
    setError('');
    setNotice('');
    try {
      await api.post('/access/users-bm', {
        name: accessName.trim(),
        email: accessEmail.trim(),
        password: accessPassword,
        clientId: accessClientId,
        role: accessRole,
      });
      setAccessName('');
      setAccessEmail('');
      setAccessPassword('');
      setNotice('Usuário criado. O acesso ficou preso à empresa e à BM configuradas.');
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível criar o acesso.');
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
      setError(requestError?.response?.data?.message || 'Não foi possível alterar o acesso.');
    } finally {
      setChangingUserId('');
    }
  }

  if (!canView) {
    return <p className="rounded-[10px] border border-amber-200 bg-amber-50 p-4 text-amber-800">Seu perfil não possui acesso à gestão de clientes.</p>;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Operações</p>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[#16231b]">Empresas e acessos</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-slate-500">
            Cada empresa possui sua própria BM, contas Meta e usuários. Nenhum resultado é somado entre empresas.
          </p>
        </div>
        <button onClick={() => { setLoading(true); void load(); }} className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-[#d9e0db] bg-white px-3.5 text-sm font-semibold text-slate-600 hover:bg-[#f7f9f7]">
          <RefreshCw size={14} /> Atualizar
        </button>
      </header>

      {canAdmin && (
        <form onSubmit={createClient} className="flex flex-col gap-2 rounded-[12px] border border-[#dfe5e1] bg-white p-4 sm:flex-row">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da nova empresa" minLength={2} required className="h-10 flex-1 rounded-[8px] border border-[#d9e0db] bg-white px-3.5 text-sm outline-none focus:border-[#8db49f]" />
          <button disabled={saving} className="h-10 rounded-[8px] bg-[#176846] px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Cadastrando...' : 'Cadastrar empresa'}</button>
        </form>
      )}

      {notice && <p className="rounded-[9px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="rounded-[9px] border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">{error}</p>}

      {loading ? (
        <section className="rounded-[12px] border border-[#dfe5e1] bg-white px-5 py-8 text-sm text-slate-500">Carregando empresas...</section>
      ) : (
        <section className="space-y-4">
          {rows.map((client) => {
            const meta = metaStatuses[client.id];
            const clientAccounts = accountsByClient.get(client.id) || [];
            const assignedAccounts = clientAccounts.filter((account) => account.isAssigned);
            const clientUsers = usersByClient.get(client.id) || [];
            const expanded = expandedClientId === client.id;
            const editingBusiness = editingBusinessClientId === client.id;
            const busy = connectingId === client.id || disconnectingId === client.id;
            const bmConfigured = Boolean(client.metaBusinessId);

            return (
              <article key={client.id} className="overflow-hidden rounded-[14px] border border-[#dce3de] bg-white shadow-[0_1px_2px_rgba(16,24,20,0.03)]">
                <div className="p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[17px] font-bold text-[#17251c]">{client.name}</h2>
                        <span className="rounded-[6px] bg-[#f1f4f2] px-2 py-1 text-[10px] font-semibold text-slate-500">ID {client.id}</span>
                        <span className={`rounded-[6px] px-2 py-1 text-[10px] font-semibold ${client.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{client.status === 'active' ? 'Ativa' : client.status || 'Sem status'}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{client.segment || 'Segmento não informado'}</p>
                    </div>

                    {canAdmin && (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => beginBusinessEdit(client)} className="rounded-[8px] border border-[#cfd9d2] px-3 py-2 text-xs font-semibold text-[#176846] hover:bg-[#f4f8f5]">
                          {bmConfigured ? 'Editar BM' : 'Vincular BM'}
                        </button>
                        <button type="button" onClick={() => { void connectMeta(client.id); }} disabled={busy} className="rounded-[8px] border border-[#cfd9d2] px-3 py-2 text-xs font-semibold text-[#176846] hover:bg-[#f4f8f5] disabled:opacity-50">
                          {connectingId === client.id ? 'Conectando...' : meta?.connected ? 'Reconectar Meta' : 'Conectar Meta'}
                        </button>
                        {meta?.connected && (
                          <button type="button" onClick={() => { void disconnectMeta(client.id, client.name); }} disabled={busy} className="rounded-[8px] border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                            {disconnectingId === client.id ? 'Desconectando...' : 'Desconectar'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[10px] border border-[#e4e9e5] bg-[#fafbfa] p-3.5">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"><Building2 size={13} /> Business Manager</div>
                      <p className="mt-2 text-sm font-semibold text-[#1b2921]">{client.metaBusinessName || 'Não vinculada'}</p>
                      <p className="mt-1 break-all text-[11px] text-slate-400">{client.metaBusinessId ? `ID ${client.metaBusinessId}` : 'Informe ID, nome e administrador'}</p>
                    </div>

                    <div className="rounded-[10px] border border-[#e4e9e5] bg-[#fafbfa] p-3.5">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"><Mail size={13} /> Administrador Meta</div>
                      <p className="mt-2 truncate text-sm font-semibold text-[#1b2921]">{client.metaAdminEmail || 'Não informado'}</p>
                      <p className="mt-1 text-[11px] text-slate-400">E-mail de referência do responsável pela BM</p>
                    </div>

                    <div className="rounded-[10px] border border-[#e4e9e5] bg-[#fafbfa] p-3.5">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"><Link2 size={13} /> Contas Meta</div>
                      <p className="mt-2 text-sm font-semibold text-[#1b2921]">{assignedAccounts.length} autorizada{assignedAccounts.length === 1 ? '' : 's'}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{clientAccounts.length} disponível{clientAccounts.length === 1 ? '' : 'is'} na conexão</p>
                    </div>

                    <div className="rounded-[10px] border border-[#e4e9e5] bg-[#fafbfa] p-3.5">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"><Users size={13} /> Usuários</div>
                      <p className="mt-2 text-sm font-semibold text-[#1b2921]">{clientUsers.length} acesso{clientUsers.length === 1 ? '' : 's'}</p>
                      <p className="mt-1 text-[11px] text-slate-400">Todos presos à BM desta empresa</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0ee] pt-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className={`h-2 w-2 rounded-full ${meta?.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      {meta?.connected ? `Meta conectada · ${meta.accountCount} contas encontradas` : 'Meta não conectada'}
                    </div>
                    {canAdmin && (
                      <button type="button" onClick={() => setExpandedClientId(expanded ? '' : client.id)} className="inline-flex items-center gap-2 rounded-[8px] border border-[#d7ded9] px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-[#f7f9f7]">
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {expanded ? 'Fechar detalhes' : 'Gerenciar contas e acessos'}
                      </button>
                    )}
                  </div>
                </div>

                {editingBusiness && canAdmin && (
                  <form onSubmit={(event) => { void saveBusinessAccess(event, client); }} className="grid gap-3 border-t border-[#e8ece9] bg-[#f8faf8] p-4 md:grid-cols-3">
                    <label className="text-xs font-semibold text-slate-600">ID da Business Manager
                      <input value={businessId} onChange={(event) => setBusinessId(event.target.value)} required placeholder="Ex.: 123456789012345" className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d8e0da] bg-white px-3 text-sm outline-none focus:border-[#8db49f]" />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">Nome da BM
                      <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} required placeholder="Nome exibido no Meta Business" className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d8e0da] bg-white px-3 text-sm outline-none focus:border-[#8db49f]" />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">E-mail do administrador da BM
                      <input value={businessAdminEmail} onChange={(event) => setBusinessAdminEmail(event.target.value)} type="email" required placeholder="administrador@empresa.com.br" className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d8e0da] bg-white px-3 text-sm outline-none focus:border-[#8db49f]" />
                    </label>
                    <div className="flex justify-end gap-2 md:col-span-3">
                      <button type="button" onClick={() => setEditingBusinessClientId('')} className="h-9 rounded-[8px] border border-[#d7ded9] px-3 text-xs font-semibold text-slate-600">Cancelar</button>
                      <button disabled={savingBusiness} className="h-9 rounded-[8px] bg-[#176846] px-4 text-xs font-semibold text-white disabled:opacity-50">{savingBusiness ? 'Salvando...' : 'Salvar vínculo da BM'}</button>
                    </div>
                  </form>
                )}

                {expanded && canAdmin && (
                  <div className="grid gap-0 border-t border-[#e8ece9] xl:grid-cols-[1.35fr_0.65fr]">
                    <section className="border-b border-[#e8ece9] xl:border-b-0 xl:border-r">
                      <div className="px-4 py-3.5">
                        <h3 className="text-sm font-semibold text-[#17251c]">Contas Meta disponíveis</h3>
                        <p className="mt-0.5 text-[11px] text-slate-400">Autorize somente as contas que pertencem a esta empresa. Elas herdam a BM configurada acima.</p>
                      </div>
                      <div className="max-h-[360px] overflow-auto border-t border-[#eef1ef]">
                        {clientAccounts.map((account) => (
                          <div key={account.id} className="flex flex-col gap-3 border-b border-[#eef1ef] px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-[#1a2820]">{account.name || `Conta ${account.accountId}`}</p>
                                {account.isAssigned && <span className="rounded-[6px] bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">Autorizada</span>}
                                {!account.isActive && <span className="rounded-[6px] bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">Desconectada</span>}
                              </div>
                              <p className="mt-1 text-[11px] text-slate-400">ID {account.accountId} · {account.currency || '-'}</p>
                            </div>
                            <button type="button" onClick={() => { void toggleAccountAssignment(account); }} disabled={assigningAccountId === account.id || (!account.isActive && !account.isAssigned) || (!bmConfigured && !account.isAssigned)} className={`shrink-0 rounded-[7px] border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${account.isAssigned ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-[#d5ddd7] bg-white text-slate-600 hover:bg-[#f7f9f7]'}`}>
                              {assigningAccountId === account.id ? 'Salvando...' : account.isAssigned ? 'Remover' : 'Autorizar conta'}
                            </button>
                          </div>
                        ))}
                        {!clientAccounts.length && <p className="px-4 py-7 text-sm text-slate-500">Nenhuma conta encontrada. Conecte a Meta nesta empresa.</p>}
                      </div>
                    </section>

                    <section>
                      <div className="px-4 py-3.5">
                        <h3 className="text-sm font-semibold text-[#17251c]">Acessos desta empresa</h3>
                        <p className="mt-0.5 text-[11px] text-slate-400">Cada usuário entra com e-mail, senha e o ID desta BM.</p>
                      </div>
                      <div className="border-t border-[#eef1ef]">
                        {clientUsers.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 border-b border-[#eef1ef] px-4 py-3 last:border-b-0">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[#1a2820]">{item.name}</p>
                              <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.email}</p>
                              <p className="mt-1 text-[10px] font-medium text-slate-500">BM {item.businessId || client.metaBusinessId || 'não vinculada'} · {item.role === 'MANAGER' ? 'Gestor' : 'Cliente'}</p>
                            </div>
                            <button type="button" onClick={() => { void toggleUser(item); }} disabled={changingUserId === item.id} className={`rounded-[7px] border px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${item.isActive ? 'border-[#d5ddd7] text-slate-600' : 'border-emerald-200 text-emerald-700'}`}>
                              {changingUserId === item.id ? '...' : item.isActive ? 'Desativar' : 'Ativar'}
                            </button>
                          </div>
                        ))}
                        {!clientUsers.length && <p className="px-4 py-7 text-sm text-slate-500">Nenhum usuário vinculado.</p>}
                      </div>
                    </section>
                  </div>
                )}
              </article>
            );
          })}

          {!rows.length && <div className="rounded-[12px] border border-[#dfe5e1] bg-white px-5 py-8 text-sm text-slate-500">Nenhuma empresa cadastrada.</div>}
        </section>
      )}

      {canAdmin && (
        <section className="rounded-[14px] border border-[#dfe5e1] bg-white">
          <div className="flex items-start gap-3 border-b border-[#e8ece9] px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-[#edf3ef] text-[#176846]"><ShieldCheck size={17} /></span>
            <div>
              <h2 className="text-[15px] font-semibold text-[#17251c]">Criar acesso de cliente</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">O usuário será vinculado automaticamente à BM da empresa escolhida.</p>
            </div>
          </div>

          <form onSubmit={createAccess} className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
            <label className="text-xs font-semibold text-slate-600">Nome
              <input value={accessName} onChange={(event) => setAccessName(event.target.value)} minLength={2} required className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] px-3 text-sm outline-none" />
            </label>
            <label className="text-xs font-semibold text-slate-600">E-mail
              <input value={accessEmail} onChange={(event) => setAccessEmail(event.target.value)} type="email" required className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] px-3 text-sm outline-none" />
            </label>
            <label className="text-xs font-semibold text-slate-600">Senha inicial
              <input value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} type="password" minLength={12} required className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] px-3 text-sm outline-none" placeholder="Mínimo 12 caracteres" />
            </label>
            <label className="text-xs font-semibold text-slate-600">Empresa
              <select value={accessClientId} onChange={(event) => setAccessClientId(event.target.value)} required className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none">
                {rows.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">BM vinculada
              <div className="mt-1.5 flex h-10 items-center gap-2 rounded-[8px] border border-[#e1e6e2] bg-[#f7f9f7] px-3 text-xs text-slate-600">
                <KeyRound size={13} className="shrink-0 text-[#176846]" />
                <span className="truncate">{selectedAccessClient?.metaBusinessId || 'Configure a BM primeiro'}</span>
              </div>
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1 text-xs font-semibold text-slate-600">Perfil
                <select value={accessRole} onChange={(event) => setAccessRole(event.target.value as 'CLIENT' | 'MANAGER')} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none"><option value="CLIENT">Cliente</option><option value="MANAGER">Gestor</option></select>
              </label>
              <button disabled={savingAccess || !selectedAccessClient?.metaBusinessId} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#176846] px-3.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><UserPlus size={14} />{savingAccess ? 'Criando...' : 'Criar'}</button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
