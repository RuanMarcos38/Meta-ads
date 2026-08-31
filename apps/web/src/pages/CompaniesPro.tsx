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
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [savingId, setSavingId] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm);
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

  useEffect(() => { void load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdmin || !name.trim()) return;
    try {
      await api.post('/clients', { name: name.trim() });
      setName('');
      await load();
      window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Não foi possível cadastrar a empresa.');
    }
  }

  function startEdit(client: Client) {
    if (!canAdmin) return;
    setError('');
    setEditing(client);
    setEditForm({
      name: client.name || '',
      companyName: client.companyName || '',
      document: client.document || '',
      email: client.email || '',
      phone: client.phone || '',
      segment: client.segment || '',
      status: client.status === 'inactive' ? 'inactive' : 'active',
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!canAdmin || !editing || !editForm.name.trim()) return;
    setSavingId(editing.id);
    setError('');
    try {
      await api.patch(`/clients/${editing.id}`, {
        name: editForm.name.trim(),
        companyName: editForm.companyName.trim() || null,
        document: editForm.document.trim() || null,
        email: editForm.email.trim().toLowerCase() || null,
        phone: editForm.phone.trim() || null,
        segment: editForm.segment.trim() || null,
        status: editForm.status,
      });
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

    {canAdmin && <form onSubmit={create} className="filter-panel flex flex-col gap-2 sm:flex-row">
      <input className="field-control flex-1" placeholder="Nome da nova empresa" value={name} onChange={(e) => setName(e.target.value)} required />
      <button className="primary-button"><Plus size={14} />Cadastrar empresa</button>
    </form>}

    {canAdmin && editing && <section className="corporate-card p-4 edit-company-panel">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="section-kicker">Editar empresa</p>
          <h2 className="text-lg font-semibold">{editing.name}</h2>
          <p className="text-sm text-slate-500">Para agrupar empresas do mesmo cliente, utilize o mesmo e-mail cadastral ou telefone. Os vínculos operacionais não são alterados.</p>
        </div>
        <button type="button" className="icon-button" title="Cancelar edição" onClick={() => { setEditing(null); setEditForm(emptyEditForm); }}><X size={14} /></button>
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
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="secondary-button" onClick={() => { setEditing(null); setEditForm(emptyEditForm); }}><X size={14} />Cancelar</button>
          <button className="primary-button" disabled={savingId === editing.id}><Save size={14} />{savingId === editing.id ? 'Salvando...' : 'Salvar alterações'}</button>
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
