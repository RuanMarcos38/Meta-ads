import { useEffect, useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  CreditCard,
  History,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type Client = {
  id: string;
  name: string;
  companyName?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  segment?: string | null;
  status?: string;
  _count?: { users: number; adAccounts: number; businessManagers: number };
};
type Health = { id: string; clientId: string; clientName: string; businessId: string; businessName: string; connected: boolean; tokenStatus: string; assignedAccountCount: number; lastSyncAt?: string | null; lastSyncStatus: string; earliestDate?: string | null; latestDate?: string | null; lastError?: string | null };
type UserRow = { id: string; name: string; email: string; role: string; clientId?: string | null; businessId?: string | null; isActive: boolean };
type EditForm = { name: string; companyName: string; document: string; email: string; phone: string; segment: string; status: 'active' | 'inactive' };
type BusinessChoice = {
  businessId: string;
  businessName: string;
  selected: boolean;
  accounts: Array<{ accountId: string; name: string; currency?: string | null; selected: boolean }>;
};

const emptyEditForm: EditForm = {
  name: '',
  companyName: '',
  document: '',
  email: '',
  phone: '',
  segment: '',
  status: 'active',
};

function groupKey(client: Client) {
  const email = client.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = client.phone?.replace(/\D/g, '');
  if (phone) return `phone:${phone}`;
  return `company:${client.id}`;
}

function groupLabel(client: Client) {
  return client.email?.trim() || client.phone?.trim() || client.name;
}

export default function CompaniesPro() {
  const user = useAuth((s) => s.user);
  const scope = useScope();
  const canAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');
  const [clients, setClients] = useState<Client[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [expanded, setExpanded] = useState('');
  const [tab, setTab] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [newBusinesses, setNewBusinesses] = useState<BusinessChoice[]>([]);
  const [newBusinessLoaded, setNewBusinessLoaded] = useState(false);
  const [newBusinessLoading, setNewBusinessLoading] = useState(false);
  const [newMetaConnectionRequired, setNewMetaConnectionRequired] = useState(false);
  const [newMetaConnecting, setNewMetaConnecting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [savingId, setSavingId] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm);
  const [editBusinesses, setEditBusinesses] = useState<BusinessChoice[]>([]);
  const [editBusinessLoading, setEditBusinessLoading] = useState(false);
  const [editBusinessLoaded, setEditBusinessLoaded] = useState(false);
  const [editMetaConnectionRequired, setEditMetaConnectionRequired] = useState(false);
  const [editMetaConnecting, setEditMetaConnecting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [ctx, h, u, full] = await Promise.all([
        api.get('/workspace/context'),
        api.get('/workspace/integration-health').catch(() => null),
        api.get('/workspace/users').catch(() => null),
        canAdmin ? api.get('/clients').catch(() => null) : Promise.resolve(null),
      ]);
      const contextClients: Client[] = Array.isArray(ctx.data?.data?.clients) ? ctx.data.data.clients : [];
      const fullClients: Client[] = Array.isArray(full?.data?.data) ? full.data.data : [];
      const contextById = new Map(contextClients.map((client) => [client.id, client]));
      setClients(fullClients.length
        ? fullClients.map((client) => ({ ...contextById.get(client.id), ...client, _count: contextById.get(client.id)?._count }))
        : contextClients);
      setHealth(Array.isArray(h?.data?.data) ? h.data.data : []);
      setUsers(Array.isArray(u?.data?.data) ? u.data.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Não foi possível carregar as empresas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    if (canAdmin) void discoverNewBusinesses();
  }, []);

  async function discoverNewBusinesses() {
    if (!canAdmin) return;
    setNewBusinessLoading(true);
    setNewMetaConnectionRequired(false);
    setError('');
    try {
      const response = await api.post('/workspace/business-managers/discover-for-new-client', {});
      const rows = Array.isArray(response.data?.data?.businesses) ? response.data.data.businesses : [];
      setNewBusinesses(rows.map((item: any) => ({
        businessId: String(item.businessId),
        businessName: String(item.businessName || item.businessId),
        selected: false,
        accounts: Array.isArray(item.accounts) ? item.accounts.map((account: any) => ({
          accountId: String(account.accountId),
          name: String(account.name || account.accountId),
          currency: account.currency || null,
          selected: false,
        })) : [],
      })));
      setNewBusinessLoaded(true);
      if (!rows.length) setError('Nenhuma Business Manager foi encontrada na conexão Meta disponível.');
    } catch (err: any) {
      setNewBusinesses([]);
      setNewBusinessLoaded(false);
      const code = err?.response?.data?.error?.code;
      if (code === 'META_CONNECTION_REQUIRED') {
        setNewMetaConnectionRequired(true);
        setError('');
      } else {
        setError(err?.response?.data?.error?.message || 'Não foi possível carregar as Business Managers disponíveis.');
      }
    } finally {
      setNewBusinessLoading(false);
    }
  }

  function toggleNewBusiness(businessId: string) {
    setNewBusinesses((current) => current.map((business) => {
      if (business.businessId !== businessId) return business;
      const selected = !business.selected;
      return {
        ...business,
        selected,
        accounts: business.accounts.map((account) => ({ ...account, selected })),
      };
    }));
  }

  function toggleNewAccount(businessId: string, accountId: string) {
    setNewBusinesses((current) => current.map((business) => business.businessId !== businessId ? business : {
      ...business,
      accounts: business.accounts.map((account) => account.accountId === accountId ? { ...account, selected: !account.selected } : account),
    }));
  }

  async function connectManagementForCompanies() {
    setNewMetaConnecting(true);
    setError('');
    const popup = window.open('about:blank', 'gestao-ads-meta-oauth', 'width=760,height=860');
    try {
      const response = await api.get('/meta/oauth/start-management');
      const authUrl = response.data?.data?.authUrl;
      if (!authUrl) throw new Error('A Meta não retornou a URL de autorização.');
      if (popup) popup.location.href = authUrl;
      else window.location.assign(authUrl);

      if (popup) {
        await new Promise<void>((resolve) => {
          const timer = window.setInterval(() => {
            if (popup.closed) {
              window.clearInterval(timer);
              resolve();
            }
          }, 800);
        });
        setNewMetaConnectionRequired(false);
        await discoverNewBusinesses();
        if (editing) await loadEditBusinesses(editing.id);
      }
    } catch (err: any) {
      popup?.close();
      setError(err?.response?.data?.error?.message || err?.message || 'Não foi possível conectar a ferramenta à Meta.');
    } finally {
      setNewMetaConnecting(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdmin || !name.trim()) return;
    if (!newBusinessLoaded) {
      await discoverNewBusinesses();
      return;
    }

    const selected = newBusinesses.filter((business) => business.selected);
    if (!selected.length) {
      setError('Selecione pelo menos uma Business Manager. A BM é obrigatória no cadastro do cliente.');
      return;
    }

    setCreating(true);
    setError('');
    try {
      await api.post('/workspace/clients/create-with-business-managers', {
        name: name.trim(),
        selections: selected.map((business) => ({
          businessId: business.businessId,
          accountIds: business.accounts.filter((account) => account.selected).map((account) => account.accountId),
        })),
      });
      setName('');
      setNewBusinesses([]);
      setNewBusinessLoaded(false);
      await load();
      window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Não foi possível cadastrar a empresa com as BMs selecionadas.');
    } finally {
      setCreating(false);
    }
  }

  async function loadEditBusinesses(clientId: string) {
    setEditBusinessLoading(true);
    setEditMetaConnectionRequired(false);
    setError('');
    try {
      const response = await api.post('/workspace/business-managers/discover-from-meta', { clientId });
      const rows = Array.isArray(response.data?.data?.businesses) ? response.data.data.businesses : [];
      setEditBusinesses(rows.map((item: any) => ({
        businessId: String(item.businessId),
        businessName: String(item.businessName || item.businessId),
        selected: Boolean(item.selected),
        accounts: Array.isArray(item.accounts) ? item.accounts.map((account: any) => ({
          accountId: String(account.accountId),
          name: String(account.name || account.accountId),
          currency: account.currency || null,
          selected: Boolean(account.selected),
        })) : [],
      })));
      setEditBusinessLoaded(true);
    } catch (err: any) {
      setEditBusinesses([]);
      setEditBusinessLoaded(false);
      const code = err?.response?.data?.error?.code;
      if (code === 'META_CONNECTION_REQUIRED') {
        setEditMetaConnectionRequired(true);
      } else {
        setError(err?.response?.data?.error?.message || 'Não foi possível carregar as Business Managers desta empresa.');
      }
    } finally {
      setEditBusinessLoading(false);
    }
  }

  function toggleEditBusiness(businessId: string) {
    setEditBusinesses((current) => current.map((business) => {
      if (business.businessId !== businessId) return business;
      const selected = !business.selected;
      return {
        ...business,
        selected,
        accounts: business.accounts.map((account) => ({ ...account, selected })),
      };
    }));
  }

  function toggleEditAccount(businessId: string, accountId: string) {
    setEditBusinesses((current) => current.map((business) => business.businessId !== businessId ? business : {
      ...business,
      accounts: business.accounts.map((account) => account.accountId === accountId ? { ...account, selected: !account.selected } : account),
    }));
  }

  async function connectEditMeta(clientId: string) {
    setEditMetaConnecting(true);
    setError('');
    const popup = window.open('about:blank', 'gestao-ads-meta-oauth', 'width=760,height=860');
    try {
      const response = await api.get('/meta/oauth/start-management');
      const authUrl = response.data?.data?.authUrl;
      if (!authUrl) throw new Error('A Meta não retornou a URL de autorização.');
      if (popup) popup.location.href = authUrl;
      else window.location.assign(authUrl);

      if (popup) {
        await new Promise<void>((resolve) => {
          const timer = window.setInterval(() => {
            if (popup.closed) {
              window.clearInterval(timer);
              resolve();
            }
          }, 800);
        });
        setEditMetaConnectionRequired(false);
        await loadEditBusinesses(clientId);
        await load();
        window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
      }
    } catch (err: any) {
      popup?.close();
      setError(err?.response?.data?.error?.message || err?.message || 'Não foi possível conectar esta empresa à Meta.');
    } finally {
      setEditMetaConnecting(false);
    }
  }

  function startEdit(client: Client) {
    if (!canAdmin) return;
    setError('');
    setEditing(client);
    setEditBusinesses([]);
    setEditBusinessLoaded(false);
    setEditMetaConnectionRequired(false);
    setEditForm({
      name: client.name || '',
      companyName: client.companyName || '',
      document: client.document || '',
      email: client.email || '',
      phone: client.phone || '',
      segment: client.segment || '',
      status: client.status === 'inactive' ? 'inactive' : 'active',
    });
    void loadEditBusinesses(client.id);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdmin || !editing || !editForm.name.trim()) return;
    setSavingId(editing.id);
    setError('');
    try {
      const selectedBusinesses = editBusinesses.filter((business) => business.selected);
      if (editBusinessLoaded && !selectedBusinesses.length) {
        setError('Selecione pelo menos uma Business Manager para esta empresa.');
        setSavingId('');
        return;
      }

      await api.patch(`/clients/${editing.id}`, {
        name: editForm.name.trim(),
        companyName: editForm.companyName.trim() || null,
        document: editForm.document.trim() || null,
        email: editForm.email.trim().toLowerCase() || null,
        phone: editForm.phone.trim() || null,
        segment: editForm.segment.trim() || null,
        status: editForm.status,
      });

      if (editBusinessLoaded) {
        await api.post('/workspace/business-managers/assign-from-meta', {
          clientId: editing.id,
          selections: selectedBusinesses.map((business) => ({
            businessId: business.businessId,
            accountIds: business.accounts.filter((account) => account.selected).map((account) => account.accountId),
          })),
        });
      }

      setEditing(null);
      setEditForm(emptyEditForm);
      await load();
      window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Não foi possível atualizar a empresa.');
    } finally {
      setSavingId('');
    }
  }

  async function remove(client: Client) {
    if (!canAdmin) return;
    const typed = window.prompt(`Esta ação exclui a empresa e os dados operacionais vinculados a ela.\n\nPara confirmar, digite exatamente o nome da empresa:\n${client.name}`);
    if (typed === null) return;
    if (typed !== client.name) {
      setError('Exclusão cancelada: o nome digitado não confere com a empresa.');
      return;
    }
    setDeletingId(client.id);
    setError('');
    try {
      await api.delete(`/workspace/clients/${client.id}`, { data: { confirmName: typed } });
      if (scope.clientId === client.id) scope.setClientId('');
      if (editing?.id === client.id) setEditing(null);
      setExpanded('');
      await load();
      window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Não foi possível excluir a empresa.');
    } finally {
      setDeletingId('');
    }
  }

  const visible = useMemo(() => scope.clientId && !canAdmin ? clients.filter((c) => c.id === scope.clientId) : clients, [clients, scope.clientId, canAdmin]);
  const groupedVisible = useMemo(() => {
    const map = new Map<string, Client[]>();
    for (const client of visible) {
      const key = groupKey(client);
      const current = map.get(key) || [];
      current.push(client);
      map.set(key, current);
    }
    return Array.from(map.entries())
      .map(([key, companies]) => ({ key, companies: [...companies].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) }))
      .sort((a, b) => groupLabel(a.companies[0]).localeCompare(groupLabel(b.companies[0]), 'pt-BR'));
  }, [visible]);
  const currentTab = (id: string) => tab[id] || 'resumo';

  return <div className="space-y-4 companies-page">
    <section className="page-heading">
      <div>
        <p className="section-kicker">Cadastro</p>
        <h1>Empresas</h1>
        <p>Empresas do mesmo cliente são agrupadas automaticamente quando compartilham o mesmo e-mail cadastral ou telefone. Cada empresa continua com BMs, contas, usuários e integrações próprios.</p>
      </div>
      <button className="secondary-button" onClick={() => { void load(); }} disabled={loading}>
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Atualizar
      </button>
    </section>

    {error && <div className="message-warning">{error}</div>}

    {canAdmin && <form onSubmit={create} className="filter-panel">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="field-control flex-1" placeholder="Nome da nova empresa" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="primary-button" disabled={newBusinessLoading || creating || newMetaConnecting || !newBusinessLoaded}>
          {newBusinessLoading ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
          {newBusinessLoading ? 'Carregando BMs...' : creating ? 'Cadastrando...' : 'Cadastrar empresa'}
        </button>
      </div>

      {newMetaConnectionRequired && <div className="message-warning mt-4 flex flex-wrap items-center justify-between gap-2">
        <span>A ferramenta precisa estar conectada à Meta uma única vez para listar as BMs disponíveis. Depois cada BM será vinculada somente à empresa selecionada.</span>
        <button type="button" className="primary-button" onClick={() => { void connectManagementForCompanies(); }} disabled={newMetaConnecting}>
          <Link2 size={13} />{newMetaConnecting ? 'Conectando ferramenta...' : 'Conectar ferramenta à Meta'}
        </button>
      </div>}

      {!newMetaConnectionRequired && <div className="mt-4 border-t border-[#e1e6e3] pt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="panel-title">Business Manager obrigatória</h2>
            <p className="panel-subtitle">Selecione uma ou mais BMs que pertencem a esta empresa. O cliente verá somente as BMs cadastradas aqui.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => { void discoverNewBusinesses(); }} disabled={newBusinessLoading}>
            <RefreshCw size={13} className={newBusinessLoading ? 'animate-spin' : ''} />Atualizar BMs
          </button>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {newBusinesses.map((business) => <article key={business.businessId} className={`rounded-[8px] border p-3 ${business.selected ? 'border-blue-200 bg-blue-50/40' : 'border-[#dfe5e2] bg-white'}`}>
            <label className="flex cursor-pointer items-start gap-2">
              <input className="mt-1" type="checkbox" checked={business.selected} onChange={() => toggleNewBusiness(business.businessId)} />
              <span className="min-w-0">
                <strong className="block text-[12px] font-semibold text-slate-700">{business.businessName}</strong>
                <small className="block text-[10px] text-slate-500">ID {business.businessId} · {business.accounts.length} conta{business.accounts.length === 1 ? '' : 's'}</small>
              </span>
            </label>
            {business.selected && <div className="mt-3 space-y-1.5 border-t border-[#e2e7e4] pt-2">
              <p className="mb-2 text-[10px] font-semibold text-slate-600">Contas autorizadas nesta BM</p>
              {business.accounts.map((account) => <label key={account.accountId} className="flex cursor-pointer items-center gap-2 rounded-[6px] border border-[#e3e8e5] bg-white px-2.5 py-2 text-[10px] text-slate-600">
                <input type="checkbox" checked={account.selected} onChange={() => toggleNewAccount(business.businessId, account.accountId)} />
                <span className="min-w-0 flex-1"><strong className="block truncate font-medium text-slate-700">{account.name}</strong><small className="text-slate-400">Conta {account.accountId}{account.currency ? ` · ${account.currency}` : ''}</small></span>
              </label>)}
              {!business.accounts.length && <p className="text-[10px] text-slate-400">Esta BM não retornou contas de anúncios.</p>}
            </div>}
          </article>)}
          {!newBusinesses.length && <div className="empty-state corporate-card col-span-full"><BriefcaseBusiness size={18} /><span>Nenhuma BM disponível para vincular.</span></div>}
        </div>
      </div>}
    </form>}

    {canAdmin && editing && <section className="corporate-card p-4 edit-company-panel">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="section-kicker">Editar empresa</p>
          <h2 className="text-lg font-semibold">{editing.name}</h2>
          <p className="text-sm text-slate-500">Para agrupar empresas do mesmo cliente, utilize o mesmo e-mail cadastral ou telefone. Os vínculos operacionais não são alterados.</p>
        </div>
        <button type="button" className="icon-button" title="Cancelar edição" onClick={() => { setEditing(null); setEditForm(emptyEditForm); setEditBusinesses([]); setEditBusinessLoaded(false); setEditMetaConnectionRequired(false); }}><X size={14} /></button>
      </div>
      <form onSubmit={saveEdit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-1"><span className="text-xs font-medium text-slate-600">Nome da empresa</span><input className="field-control w-full" value={editForm.name} onChange={(e) => setEditForm((v) => ({ ...v, name: e.target.value }))} required /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-slate-600">Razão social</span><input className="field-control w-full" value={editForm.companyName} onChange={(e) => setEditForm((v) => ({ ...v, companyName: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-slate-600">CNPJ / Documento</span><input className="field-control w-full" value={editForm.document} onChange={(e) => setEditForm((v) => ({ ...v, document: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-slate-600">E-mail do cliente</span><input type="email" className="field-control w-full" value={editForm.email} onChange={(e) => setEditForm((v) => ({ ...v, email: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-slate-600">Telefone do cliente</span><input className="field-control w-full" value={editForm.phone} onChange={(e) => setEditForm((v) => ({ ...v, phone: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-slate-600">Segmento</span><input className="field-control w-full" value={editForm.segment} onChange={(e) => setEditForm((v) => ({ ...v, segment: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-slate-600">Status</span><select className="field-control w-full" value={editForm.status} onChange={(e) => setEditForm((v) => ({ ...v, status: e.target.value as EditForm['status'] }))}><option value="active">Ativa</option><option value="inactive">Inativa</option></select></label>
        </div>
        <div className="rounded-[8px] border border-[#dfe5e2] bg-[#fbfcfb] p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="panel-title">Business Managers desta empresa</h3>
              <p className="panel-subtitle">Selecione uma ou mais BMs e as contas de anúncios autorizadas. O cliente terá acesso somente ao que estiver marcado aqui.</p>
            </div>
            {!editMetaConnectionRequired && <button type="button" className="secondary-button" onClick={() => { void loadEditBusinesses(editing.id); }} disabled={editBusinessLoading}>
              <RefreshCw size={13} className={editBusinessLoading ? 'animate-spin' : ''} />Atualizar BMs
            </button>}
          </div>

          {editBusinessLoading && <div className="empty-state"><RefreshCw size={18} className="animate-spin" /><span>Carregando BMs disponíveis na Meta...</span></div>}

          {!editBusinessLoading && editMetaConnectionRequired && <div className="message-warning flex flex-wrap items-center justify-between gap-2">
            <span>A ferramenta ainda não possui conexão Meta global ativa. Conecte a ferramenta uma única vez; depois selecione aqui somente as BMs que pertencem a esta empresa.</span>
            <button type="button" className="primary-button" onClick={() => { void connectEditMeta(editing.id); }} disabled={editMetaConnecting}>
              <Link2 size={13} />{editMetaConnecting ? 'Conectando ferramenta...' : 'Conectar ferramenta à Meta'}
            </button>
          </div>}

          {!editBusinessLoading && editBusinessLoaded && <div className="grid gap-3 xl:grid-cols-2">
            {editBusinesses.map((business) => <article key={business.businessId} className={`rounded-[8px] border p-3 ${business.selected ? 'border-blue-200 bg-blue-50/40' : 'border-[#dfe5e2] bg-white'}`}>
              <label className="flex cursor-pointer items-start gap-2">
                <input className="mt-1" type="checkbox" checked={business.selected} onChange={() => toggleEditBusiness(business.businessId)} />
                <span className="min-w-0">
                  <strong className="block text-[12px] font-semibold text-slate-700">{business.businessName}</strong>
                  <small className="block text-[10px] text-slate-500">ID {business.businessId} · {business.accounts.length} conta{business.accounts.length === 1 ? '' : 's'}</small>
                </span>
              </label>
              {business.selected && <div className="mt-3 space-y-1.5 border-t border-[#e2e7e4] pt-2">
                <p className="mb-2 text-[10px] font-semibold text-slate-600">Contas autorizadas nesta BM</p>
                {business.accounts.map((account) => <label key={account.accountId} className="flex cursor-pointer items-center gap-2 rounded-[6px] border border-[#e3e8e5] bg-white px-2.5 py-2 text-[10px] text-slate-600">
                  <input type="checkbox" checked={account.selected} onChange={() => toggleEditAccount(business.businessId, account.accountId)} />
                  <span className="min-w-0 flex-1"><strong className="block truncate font-medium text-slate-700">{account.name}</strong><small className="text-slate-400">Conta {account.accountId}{account.currency ? ` · ${account.currency}` : ''}</small></span>
                </label>)}
                {!business.accounts.length && <p className="text-[10px] text-slate-400">Esta BM não retornou contas de anúncios.</p>}
              </div>}
            </article>)}
            {!editBusinesses.length && <div className="empty-state corporate-card col-span-full"><BriefcaseBusiness size={18} /><span>Nenhuma BM encontrada para o usuário Meta conectado.</span></div>}
          </div>}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="secondary-button" onClick={() => { setEditing(null); setEditForm(emptyEditForm); setEditBusinesses([]); setEditBusinessLoaded(false); setEditMetaConnectionRequired(false); }}><X size={14} />Cancelar</button>
          <button className="primary-button" disabled={savingId === editing.id || editBusinessLoading || editMetaConnecting}><Save size={14} />{savingId === editing.id ? 'Salvando...' : 'Salvar empresa e BMs'}</button>
        </div>
      </form>
    </section>}

    <section className="corporate-card overflow-hidden">
      <div className="table-scroll">
        <table className="corporate-table companies-table">
          <thead><tr><th>Empresa</th><th>BMs</th><th>Contas</th><th>Usuários</th><th>Meta</th><th>Última sincronização</th><th>Ações</th></tr></thead>
          <tbody>
            {groupedVisible.flatMap((group) => {
              const rows: React.ReactNode[] = [];
              if (group.companies.length > 1) {
                rows.push(<tr key={`${group.key}-header`} className="client-group-row"><td colSpan={7}><div className="client-group-label"><Users size={14} /><span>Cliente</span><strong>{groupLabel(group.companies[0])}</strong><small>{group.companies.length} empresas</small></div></td></tr>);
              }
              for (const client of group.companies) {
                const hs = health.filter((h) => h.clientId === client.id);
                const connected = hs.some((h) => h.connected);
                const assigned = hs.reduce((s, h) => s + h.assignedAccountCount, 0);
                const last = [...hs].filter((h) => h.lastSyncAt).sort((a, b) => String(b.lastSyncAt).localeCompare(String(a.lastSyncAt)))[0];
                rows.push(<tr key={client.id} className={group.companies.length > 1 ? 'grouped-company-row' : ''}>
                  <td><strong>{client.name}</strong><small>{client.companyName || client.email || client.id}</small></td>
                  <td>{client._count?.businessManagers ?? hs.length}</td>
                  <td>{assigned}</td>
                  <td>{client._count?.users ?? users.filter((u) => u.clientId === client.id).length}</td>
                  <td><span className={`status-chip ${connected ? 'status-success' : 'status-neutral'}`}>{connected ? 'Conectada' : 'Desconectada'}</span></td>
                  <td>{last?.lastSyncAt ? new Date(last.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                  <td><div className="flex items-center gap-1">
                    <button className="icon-button" title={expanded === client.id ? 'Fechar detalhes' : 'Abrir detalhes'} onClick={() => setExpanded(expanded === client.id ? '' : client.id)}>{expanded === client.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                    {canAdmin && <button className="icon-button" title="Editar empresa" onClick={() => startEdit(client)}><Pencil size={14} /></button>}
                    {canAdmin && <button className="icon-button text-red-600" title="Excluir empresa" disabled={deletingId === client.id} onClick={() => { void remove(client); }}><Trash2 size={14} /></button>}
                  </div></td>
                </tr>);
              }
              return rows;
            })}
            {!visible.length && !loading && <tr><td colSpan={7}><div className="empty-state"><BriefcaseBusiness size={18} /><span>Nenhuma empresa cadastrada.</span></div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    {visible.map((client) => expanded === client.id && <section key={`${client.id}-detail`} className="corporate-card overflow-hidden company-detail-panel">
      <div className="flex flex-wrap gap-1 border-b border-[#e1e6e3] px-3 pt-3">
        {[['resumo', 'Resumo'], ['bms', 'BMs'], ['contas', 'Contas'], ['usuarios', 'Usuários'], ['integracao', 'Integração'], ['historico', 'Histórico']].map(([key, label]) => <button key={key} className={`tab-button ${currentTab(client.id) === key ? 'tab-active' : ''}`} onClick={() => setTab((v) => ({ ...v, [client.id]: key }))}>{label}</button>)}
      </div>
      <div className="p-4">
        {currentTab(client.id) === 'resumo' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="mini-stat"><span>Business Managers</span><strong>{health.filter((h) => h.clientId === client.id).length}</strong><small>mapeadas</small></div><div className="mini-stat"><span>Contas autorizadas</span><strong>{health.filter((h) => h.clientId === client.id).reduce((s, h) => s + h.assignedAccountCount, 0)}</strong><small>no dashboard</small></div><div className="mini-stat"><span>Usuários</span><strong>{users.filter((u) => u.clientId === client.id && u.isActive).length}</strong><small>ativos</small></div><div className="mini-stat"><span>Status</span><strong>{health.some((h) => h.clientId === client.id && h.connected) ? 'Online' : 'Pendente'}</strong><small>integração Meta</small></div></div>}
        {currentTab(client.id) === 'bms' && <div className="space-y-2">{health.filter((h) => h.clientId === client.id).map((h) => <div key={h.id} className="detail-row"><BriefcaseBusiness size={14} /><div><strong>{h.businessName}</strong><small>ID {h.businessId} · token {h.tokenStatus}</small></div><span>{h.assignedAccountCount} conta(s)</span></div>)}{!health.some((h) => h.clientId === client.id) && <div className="empty-state"><BriefcaseBusiness size={18} /><span>Nenhuma BM mapeada.</span></div>}</div>}
        {currentTab(client.id) === 'contas' && <div className="space-y-2">{scope.accounts.filter((a) => a.clientId === client.id).map((a) => <div key={a.id} className="detail-row"><CreditCard size={14} /><div><strong>{a.name || a.accountId}</strong><small>{a.businessName || 'BM não identificada'} · {a.accountId}</small></div><span className={`status-chip ${a.isAssigned ? 'status-success' : 'status-neutral'}`}>{a.isAssigned ? 'Autorizada' : 'Não autorizada'}</span></div>)}</div>}
        {currentTab(client.id) === 'usuarios' && <div className="space-y-2">{users.filter((u) => u.clientId === client.id).map((u) => <div key={u.id} className="detail-row"><Users size={14} /><div><strong>{u.name}</strong><small>{u.email} · {u.role}</small></div><span className={`status-chip ${u.isActive ? 'status-success' : 'status-neutral'}`}>{u.isActive ? 'Ativo' : 'Inativo'}</span></div>)}</div>}
        {currentTab(client.id) === 'integracao' && <div className="space-y-2">{health.filter((h) => h.clientId === client.id).map((h) => <div key={h.id} className="detail-row"><Link2 size={14} /><div><strong>{h.businessName}</strong><small>{h.connected ? 'Conectada' : 'Desconectada'} · token {h.tokenStatus}</small></div><span>{h.lastSyncStatus}</span></div>)}</div>}
        {currentTab(client.id) === 'historico' && <div className="space-y-2">{health.filter((h) => h.clientId === client.id).map((h) => <div key={h.id} className="detail-row"><History size={14} /><div><strong>{h.businessName}</strong><small>{h.earliestDate ? new Date(h.earliestDate).toLocaleDateString('pt-BR') : '—'} até {h.latestDate ? new Date(h.latestDate).toLocaleDateString('pt-BR') : '—'}</small></div><span>{h.lastSyncAt ? new Date(h.lastSyncAt).toLocaleDateString('pt-BR') : '—'}</span></div>)}</div>}
      </div>
    </section>)}
  </div>;
}
