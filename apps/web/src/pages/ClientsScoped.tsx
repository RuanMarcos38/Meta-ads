import { useEffect, useMemo, useState } from 'react';
import { Link2, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../store';

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
  isActive: boolean;
  lastLoginAt?: string | null;
  client?: { name?: string | null } | null;
};

export default function ClientsScoped() {
  const user = useAuth((state) => state.user);
  const canView = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const canAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [metaStatuses, setMetaStatuses] = useState<Record<string, MetaClientStatus>>({});
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [connectingId, setConnectingId] = useState('');
  const [disconnectingId, setDisconnectingId] = useState('');
  const [assigningAccountId, setAssigningAccountId] = useState('');
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
        canAdmin ? api.get('/access/users').catch(() => null) : Promise.resolve(null),
      ]);

      const clients = Array.isArray(clientsResponse.data?.data) ? clientsResponse.data.data : [];
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
      setError(requestError?.response?.data?.message || 'Não foi possível carregar os clientes deste acesso.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [canView, canAdmin]);

  const clientMap = useMemo(
    () => Object.fromEntries(rows.map((client) => [String(client.id), String(client.name || 'Empresa')])),
    [rows],
  );

  const assignmentSummary = useMemo(() => {
    const map: Record<string, { total: number; assigned: number }> = {};
    for (const account of accounts) {
      map[account.clientId] ??= { total: 0, assigned: 0 };
      map[account.clientId].total += 1;
      if (account.isAssigned) map[account.clientId].assigned += 1;
    }
    return map;
  }, [accounts]);

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
      setNotice('Cliente cadastrado com sucesso.');
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'O cliente não foi cadastrado.');
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
          setNotice('Meta Ads conectado. Agora selecione abaixo quais contas pertencem a esta empresa.');
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
      await api.patch(`/meta/client-accounts/${account.id}/assignment`, { isAssigned: !account.isAssigned });
      setNotice(account.isAssigned
        ? 'Conta removida do dashboard e dos usuários desta empresa. O histórico foi preservado.'
        : 'Conta vinculada à empresa. Ela passa a fazer parte do dashboard e das sincronizações.');
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
      await api.post('/access/users', {
        name: accessName.trim(),
        email: accessEmail.trim(),
        password: accessPassword,
        clientId: accessClientId,
        role: accessRole,
      });
      setAccessName('');
      setAccessEmail('');
      setAccessPassword('');
      setNotice('Usuário criado e vinculado somente à empresa selecionada.');
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Operações</p>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[#16231b]">Clientes</h1>
          <p className="mt-1 text-[13px] text-slate-500">Conexões Meta e acessos separados por empresa, sem compartilhamento de resultados.</p>
        </div>
        <button onClick={() => { setLoading(true); void load(); }} className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-[#d9e0db] bg-white px-3.5 text-sm font-semibold text-slate-600 hover:bg-[#f7f9f7]">
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {canAdmin && (
        <form onSubmit={createClient} className="flex flex-col gap-2 sm:flex-row">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do cliente" minLength={2} required className="h-10 flex-1 rounded-[8px] border border-[#d9e0db] bg-white px-3.5 text-sm outline-none focus:border-[#8db49f]" />
          <button disabled={saving} className="h-10 rounded-[8px] bg-[#176846] px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Cadastrando...' : 'Cadastrar'}</button>
        </form>
      )}

      {notice && <p className="rounded-[9px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="rounded-[9px] border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">{error}</p>}

      <section className="overflow-hidden rounded-[12px] border border-[#dfe5e1] bg-white">
        <div className="border-b border-[#e8ece9] px-4 py-3.5">
          <h2 className="text-[15px] font-semibold text-[#17251c]">Empresas e integrações</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">Cada conexão Meta pertence exclusivamente à empresa cadastrada.</p>
        </div>
        {loading ? (
          <p className="px-4 py-7 text-sm text-slate-500">Carregando clientes...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-sm">
              <thead className="bg-[#fafbfa] text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                <tr><th className="px-4 py-3">Empresa</th><th className="px-3 py-3">Segmento</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Meta Ads</th><th className="px-3 py-3">Contas no dashboard</th><th className="px-4 py-3 text-right">Ação</th></tr>
              </thead>
              <tbody>
                {rows.map((client) => {
                  const id = String(client.id);
                  const meta = metaStatuses[id];
                  const assignment = assignmentSummary[id] || { total: 0, assigned: 0 };
                  const busy = connectingId === id || disconnectingId === id;
                  return (
                    <tr key={id} className="border-t border-[#eef1ef] text-[13px]">
                      <td className="px-4 py-3.5 font-semibold text-[#1a2820]">{client.name}</td>
                      <td className="px-3 py-3.5 text-slate-500">{client.segment || '-'}</td>
                      <td className="px-3 py-3.5 text-slate-500">{client.status || '-'}</td>
                      <td className="px-3 py-3.5">
                        {meta?.connected ? <span className="inline-flex rounded-[6px] bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Conectado · {meta.accountCount} disponíveis</span> : <span className="inline-flex rounded-[6px] bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">Não conectado</span>}
                      </td>
                      <td className="px-3 py-3.5 text-slate-600"><strong className="font-semibold text-[#1a2820]">{assignment.assigned}</strong> de {assignment.total}</td>
                      <td className="px-4 py-3.5 text-right">
                        {canAdmin ? <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => { void connectMeta(id); }} disabled={busy} className="rounded-[7px] border border-[#cdd8d1] px-3 py-1.5 text-xs font-semibold text-[#176846] hover:bg-[#f3f7f4] disabled:opacity-50">{connectingId === id ? 'Conectando...' : meta?.connected ? 'Reconectar Meta' : 'Conectar Meta'}</button>
                          {meta?.connected && <button type="button" onClick={() => { void disconnectMeta(id, String(client.name)); }} disabled={busy} className="rounded-[7px] border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">{disconnectingId === id ? 'Desconectando...' : 'Desconectar'}</button>}
                        </div> : <span className="text-xs text-slate-400">Somente administrador</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canAdmin && (
        <section className="overflow-hidden rounded-[12px] border border-[#dfe5e1] bg-white">
          <div className="flex items-start gap-3 border-b border-[#e8ece9] px-4 py-3.5">
            <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-[#edf3ef] text-[#176846]"><Link2 size={17} /></span>
            <div>
              <h2 className="text-[15px] font-semibold text-[#17251c]">Contas Meta autorizadas por empresa</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">Somente contas marcadas como “No dashboard” entram na sincronização e ficam visíveis aos usuários da empresa.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-[#fafbfa] text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                <tr><th className="px-4 py-3">Empresa</th><th className="px-3 py-3">Business Manager</th><th className="px-3 py-3">Conta Meta Ads</th><th className="px-3 py-3">Moeda</th><th className="px-3 py-3">Conexão</th><th className="px-4 py-3 text-right">Visibilidade</th></tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="border-t border-[#eef1ef] text-[13px]">
                    <td className="px-4 py-3.5 font-semibold text-[#1a2820]">{clientMap[account.clientId] || 'Empresa'}</td>
                    <td className="px-3 py-3.5 text-slate-500">{account.businessName || 'BM não identificada'}</td>
                    <td className="px-3 py-3.5"><span className="block font-medium text-slate-700">{account.name || `Conta ${account.accountId}`}</span><span className="mt-0.5 block text-[10px] text-slate-400">ID {account.accountId}</span></td>
                    <td className="px-3 py-3.5 text-slate-500">{account.currency || '-'}</td>
                    <td className="px-3 py-3.5">{account.isActive ? <span className="inline-flex rounded-[6px] bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Ativa</span> : <span className="inline-flex rounded-[6px] bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">Desconectada</span>}</td>
                    <td className="px-4 py-3.5 text-right">
                      <button type="button" onClick={() => { void toggleAccountAssignment(account); }} disabled={assigningAccountId === account.id || (!account.isActive && !account.isAssigned)} className={`rounded-[7px] border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${account.isAssigned ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-[#d5ddd7] bg-white text-slate-600 hover:bg-[#f7f9f7]'}`}>
                        {assigningAccountId === account.id ? 'Salvando...' : account.isAssigned ? 'No dashboard' : 'Vincular ao dashboard'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!accounts.length && <p className="px-4 py-7 text-sm text-slate-500">Conecte a Meta em uma empresa para listar as contas disponíveis.</p>}
        </section>
      )}

      {canAdmin && (
        <section className="rounded-[12px] border border-[#dfe5e1] bg-white">
          <div className="flex items-start gap-3 border-b border-[#e8ece9] px-4 py-3.5">
            <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-[#edf3ef] text-[#176846]"><ShieldCheck size={17} /></span>
            <div>
              <h2 className="text-[15px] font-semibold text-[#17251c]">Acessos por empresa</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">Usuários Cliente e Gestor ficam vinculados a uma única empresa no token e no backend.</p>
            </div>
          </div>

          <form onSubmit={createAccess} className="grid gap-3 border-b border-[#e8ece9] p-4 md:grid-cols-2 xl:grid-cols-5">
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
                {rows.map((client) => <option key={String(client.id)} value={String(client.id)}>{client.name}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1 text-xs font-semibold text-slate-600">Perfil
                <select value={accessRole} onChange={(event) => setAccessRole(event.target.value as 'CLIENT' | 'MANAGER')} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none"><option value="CLIENT">Cliente</option><option value="MANAGER">Gestor</option></select>
              </label>
              <button disabled={savingAccess} className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#176846] px-3.5 text-xs font-semibold text-white disabled:opacity-50"><UserPlus size={14} />{savingAccess ? 'Criando...' : 'Criar acesso'}</button>
            </div>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-[#fafbfa] text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"><tr><th className="px-4 py-3">Usuário</th><th className="px-3 py-3">Empresa</th><th className="px-3 py-3">Perfil</th><th className="px-3 py-3">Status</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
              <tbody>{users.map((item) => <tr key={item.id} className="border-t border-[#eef1ef] text-[13px]"><td className="px-4 py-3.5"><span className="block font-semibold text-[#1a2820]">{item.name}</span><span className="mt-0.5 block text-[11px] text-slate-400">{item.email}</span></td><td className="px-3 py-3.5 text-slate-500">{item.client?.name || clientMap[String(item.clientId)] || '-'}</td><td className="px-3 py-3.5 text-slate-500">{item.role === 'MANAGER' ? 'Gestor' : 'Cliente'}</td><td className="px-3 py-3.5"><span className={`inline-flex rounded-[6px] px-2 py-1 text-[11px] font-semibold ${item.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{item.isActive ? 'Ativo' : 'Inativo'}</span></td><td className="px-4 py-3.5 text-right"><button type="button" onClick={() => { void toggleUser(item); }} disabled={changingUserId === item.id} className="rounded-[7px] border border-[#d5ddd7] px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-[#f7f9f7] disabled:opacity-50">{changingUserId === item.id ? 'Salvando...' : item.isActive ? 'Desativar' : 'Ativar'}</button></td></tr>)}</tbody>
            </table>
          </div>
          {!users.length && <p className="px-4 py-7 text-sm text-slate-500">Nenhum acesso de cliente criado.</p>}
        </section>
      )}
    </div>
  );
}
