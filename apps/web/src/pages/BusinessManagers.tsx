import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Clock3, RefreshCw, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type Manager = { id: string; clientId: string; metaBusinessId: string; name: string; adminEmail?: string | null; status: string; connectionStatus?: string; tokenStatus?: string; lastSyncAt?: string | null; lastHistorySyncAt?: string | null; lastError?: string | null; client?: { id: string; name: string }; _count?: { adAccounts: number } };
type Health = { id: string; clientId: string; clientName: string; businessId: string; businessName: string; adminEmail?: string | null; connected: boolean; tokenStatus: string; tokenExpiresAt?: string | null; accountCount: number; assignedAccountCount: number; lastSyncAt?: string | null; lastSyncStatus: string; recordsProcessed: number; lastError?: string | null; earliestDate?: string | null; latestDate?: string | null; dataRows: number };

export default function BusinessManagers() {
  const user = useAuth((state) => state.user);
  const scope = useScope();
  const isAdmin = ['SUPER_ADMIN','AGENCY_ADMIN'].includes(user?.role || '');
  const [rows, setRows] = useState<Manager[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const [managersResponse, healthResponse] = await Promise.all([
        api.get('/workspace/business-managers', { params: { ...(scope.clientId ? { clientId: scope.clientId } : {}) } }),
        api.get('/workspace/integration-health', { params: { ...(scope.clientId ? { clientId: scope.clientId } : {}), ...(scope.businessId ? { businessId: scope.businessId } : {}) } }),
      ]);
      setRows(Array.isArray(managersResponse.data?.data) ? managersResponse.data.data : []);
      setHealth(Array.isArray(healthResponse.data?.data) ? healthResponse.data.data : []);
    } catch (e: any) { setError(e?.response?.data?.error?.message || 'Não foi possível carregar as Business Managers.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [scope.clientId, scope.businessId]);

  async function refresh() {
    setRefreshing(true); setError('');
    try {
      await api.post('/workspace/business-managers/import-from-meta', { ...(scope.clientId ? { clientId: scope.clientId } : {}) });
      window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
      await load();
    } catch (e: any) { setError(e?.response?.data?.error?.message || 'Não foi possível atualizar as BMs pela Meta.'); }
    finally { setRefreshing(false); }
  }

  async function sync(manager: Manager, fullHistory = false) {
    setSyncing(manager.id); setError('');
    try { await api.post(`/workspace/business-managers/${manager.id}/sync`, { fullHistory }); await load(); }
    catch (e: any) { setError(e?.response?.data?.error?.message || 'Não foi possível sincronizar esta BM.'); }
    finally { setSyncing(''); }
  }

  async function saveEmail(manager: Manager, value: string) {
    try { await api.patch(`/workspace/business-managers/${manager.id}`, { adminEmail: value.trim() || null }); await load(); }
    catch (e: any) { setError(e?.response?.data?.error?.message || 'Não foi possível salvar o e-mail administrativo.'); }
  }

  const displayRows = useMemo(() => rows.filter((row) => !scope.businessId || row.metaBusinessId === scope.businessId), [rows, scope.businessId]);
  const healthMap = new Map(health.map((item) => [item.businessId, item]));

  return <div className="space-y-4">
    <section className="page-heading"><div><p className="section-kicker">Estrutura Meta</p><h1>Business Managers</h1><p>Cada BM fica isolada por empresa, com contas, token, histórico e sincronização próprios.</p></div>{isAdmin && <button className="primary-button" onClick={() => { void refresh(); }} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Consultando Meta' : 'Atualizar BMs'}</button>}</section>
    {error && <div className="message-warning">{error}</div>}
    <section className="grid gap-3 xl:grid-cols-2">{displayRows.map((row) => { const h = healthMap.get(row.metaBusinessId); return <article key={row.id} className="corporate-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] bg-[#eff6ff] text-[#2563eb]"><BriefcaseBusiness size={17} /></span><div className="min-w-0"><h2 className="truncate text-[14px] font-semibold">{row.name}</h2><p className="mt-0.5 text-[10px] text-slate-400">ID da BM: {row.metaBusinessId}</p><p className="mt-0.5 text-[10px] text-slate-500">Empresa: {row.client?.name || h?.clientName || row.clientId}</p></div></div><span className={`status-chip ${h?.connected && h.tokenStatus === 'valid' ? 'status-success' : h?.connected ? 'status-warning' : 'status-neutral'}`}>{h?.connected ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}{h?.connected ? `Meta ${h.tokenStatus}` : 'Desconectada'}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div className="mini-stat"><span>Contas</span><strong>{h?.assignedAccountCount ?? row._count?.adAccounts ?? 0}</strong><small>autorizadas</small></div><div className="mini-stat"><span>Histórico</span><strong>{h?.dataRows?.toLocaleString('pt-BR') || '0'}</strong><small>linhas no banco</small></div><div className="mini-stat"><span>Última sync</span><strong>{h?.lastSyncAt ? new Date(h.lastSyncAt).toLocaleDateString('pt-BR') : '—'}</strong><small>{h?.lastSyncStatus || 'nunca'}</small></div><div className="mini-stat"><span>Período</span><strong>{h?.earliestDate ? new Date(h.earliestDate).toLocaleDateString('pt-BR') : '—'}</strong><small>até {h?.latestDate ? new Date(h.latestDate).toLocaleDateString('pt-BR') : '—'}</small></div></div><div className="mt-4 border-t border-[#e3e8e5] pt-3"><label className="field-label">E-mail administrativo da BM<input defaultValue={row.adminEmail || ''} onBlur={(e) => { if (isAdmin && e.target.value !== (row.adminEmail || '')) void saveEmail(row,e.target.value); }} readOnly={!isAdmin} placeholder="responsavel@empresa.com.br" className="field-control mt-1 max-w-md" /></label></div>{h?.lastError && <div className="message-warning mt-3">{h.lastError}</div>}<div className="mt-3 flex flex-wrap items-center gap-2"><button className="secondary-button" disabled={syncing === row.id} onClick={() => { void sync(row,false); }}><RefreshCw size={13} className={syncing === row.id ? 'animate-spin' : ''} />Sincronizar agora</button><button className="secondary-button" disabled={syncing === row.id} onClick={() => { void sync(row,true); }}><Clock3 size={13} />Importar histórico</button><span className="ml-auto text-[9px] text-slate-400">{h?.tokenExpiresAt ? `Token até ${new Date(h.tokenExpiresAt).toLocaleDateString('pt-BR')}` : ''}</span></div></article>; })}{!displayRows.length && !loading && <div className="empty-state corporate-card col-span-full"><Wrench size={20} /><span>Nenhuma BM persistida ainda. Use “Atualizar BMs” após conectar a Meta.</span></div>}</section>
  </div>;
}
