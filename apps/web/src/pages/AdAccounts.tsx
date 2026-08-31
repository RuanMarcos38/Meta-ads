import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Link2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type Account = { id: string; clientId: string; businessId?: string | null; businessName?: string | null; accountId: string; name?: string | null; currency?: string | null; timezone?: string | null; accountStatus?: number | null; isActive: boolean; isAssigned: boolean; updatedAt?: string };

export default function AdAccounts() {
  const user = useAuth((state) => state.user);
  const scope = useScope();
  const canAdmin = ['SUPER_ADMIN','AGENCY_ADMIN'].includes(user?.role || '');
  const [accounts,setAccounts] = useState<Account[]>([]);
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState('');
  const [error,setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await api.get('/workspace/context');
      const list = Array.isArray(response.data?.data?.accounts) ? response.data.data.accounts : [];
      setAccounts(list);
    } catch (e:any) { setError(e?.response?.data?.error?.message || 'Não foi possível carregar as contas Meta.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [scope.clientId,scope.businessId]);

  const filtered = useMemo(() => accounts.filter((item) => (!scope.clientId || item.clientId === scope.clientId) && (!scope.businessId || item.businessId === scope.businessId)), [accounts,scope.clientId,scope.businessId]);
  const grouped = useMemo(() => {
    const map = new Map<string,{ businessId:string; name:string; rows:Account[] }>();
    filtered.forEach((item) => { const key = item.businessId || '__SEM_BM__'; const current = map.get(key) || { businessId:key, name:item.businessName || 'BM não identificada', rows:[] }; current.rows.push(item); map.set(key,current); });
    return Array.from(map.values()).sort((a,b) => a.name.localeCompare(b.name));
  },[filtered]);

  async function toggle(account:Account) {
    if (!canAdmin) return;
    setSaving(account.id); setError('');
    try {
      await api.patch(`/meta/client-accounts/${account.id}/assignment`, { isAssigned: !account.isAssigned });
      await load();
      window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
    } catch (e:any) { setError(e?.response?.data?.error?.message || 'Não foi possível alterar a autorização desta conta.'); }
    finally { setSaving(''); }
  }

  return <div className="space-y-4">
    <section className="page-heading"><div><p className="section-kicker">Estrutura Meta</p><h1>Contas Meta</h1><p>Contas separadas por Business Manager. Somente contas autorizadas entram em dashboards, campanhas e sincronizações.</p></div><button className="secondary-button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={14} className={loading?'animate-spin':''} />Atualizar</button></section>
    {error && <div className="message-warning">{error}</div>}
    <div className="space-y-3">{grouped.map((group) => <section key={group.businessId} className="corporate-card overflow-hidden"><header className="flex flex-col gap-2 border-b border-[#e2e7e4] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="metric-icon"><ShieldCheck size={15} /></span><div><h2 className="panel-title">{group.name}</h2><p className="panel-subtitle">ID: {group.businessId === '__SEM_BM__' ? 'não identificado' : group.businessId} · {group.rows.filter((row) => row.isAssigned).length} de {group.rows.length} autorizada(s)</p></div></div></header><div className="table-scroll"><table className="corporate-table"><thead><tr><th>Conta</th><th>ID</th><th>Moeda</th><th>Fuso</th><th>Meta</th><th>Dashboard</th><th>Ação</th></tr></thead><tbody>{group.rows.sort((a,b) => String(a.name||a.accountId).localeCompare(String(b.name||b.accountId))).map((account) => <tr key={account.id}><td><strong>{account.name || 'Conta sem nome'}</strong></td><td>{account.accountId}</td><td>{account.currency || '—'}</td><td>{account.timezone || '—'}</td><td><span className={`status-chip ${account.isActive ? 'status-success':'status-neutral'}`}>{account.isActive ? <CheckCircle2 size={12}/>:<Unlink size={12}/>} {account.isActive ? 'Conectada':'Desconectada'}</span></td><td><span className={`status-chip ${account.isAssigned?'status-success':'status-neutral'}`}>{account.isAssigned?'Autorizada':'Fora do dashboard'}</span></td><td>{canAdmin ? <button className={account.isAssigned?'secondary-button':'primary-button'} disabled={saving===account.id || !account.isActive} onClick={() => { void toggle(account); }}>{account.isAssigned?<Unlink size={13}/>:<Link2 size={13}/>} {saving===account.id?'Salvando':account.isAssigned?'Remover':'Autorizar'}</button>:<span className="text-[10px] text-slate-400">Somente administrador</span>}</td></tr>)}</tbody></table></div></section>)}{!grouped.length && !loading && <div className="corporate-card empty-state"><CreditCard size={20}/><span>Nenhuma conta encontrada para o escopo selecionado.</span></div>}</div>
  </div>;
}
