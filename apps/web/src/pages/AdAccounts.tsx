import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, Link2, RefreshCw, ShieldCheck, Unlink, WalletCards } from 'lucide-react';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type Account = { id: string; clientId: string; businessId?: string | null; businessName?: string | null; accountId: string; name?: string | null; currency?: string | null; timezone?: string | null; accountStatus?: number | null; isActive: boolean; isAssigned: boolean; updatedAt?: string };
type LiveAccount = { id: string; accountId: string; currency?: string | null; accountStatusCode?: number | null; accountStatusLabel?: string; financialStatusKey?: string; financialStatusLabel?: string; severity?: 'success'|'info'|'warning'|'danger'|'neutral'; isPrepayAccount?: boolean | null; balance?: number | null; balanceKind?: 'prepaid_available'|'meta_balance'|'unavailable'; balanceLabel?: string; amountSpent?: number | null; spendCap?: number | null; remainingSpendLimit?: number | null; fundingSourceLabel?: string | null; disableReasonCode?: number | null; updatedAt?: string; error?: string };

function money(value: number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  try { return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: currency || 'BRL' }); }
  catch { return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
}
function statusClasses(severity?: LiveAccount['severity']) {
  if (severity === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (severity === 'danger') return 'border-red-200 bg-red-50 text-red-700';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (severity === 'info') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export default function AdAccounts() {
  const user = useAuth((state) => state.user);
  const scope = useScope();
  const canAdmin = ['SUPER_ADMIN','AGENCY_ADMIN'].includes(user?.role || '');
  const [accounts,setAccounts] = useState<Account[]>([]);
  const [live,setLive] = useState<Record<string,LiveAccount>>({});
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState('');
  const [error,setError] = useState('');

  async function load(force = false) {
    setLoading(true); setError('');
    try {
      const response = await api.get('/workspace/context');
      const list = Array.isArray(response.data?.data?.accounts) ? response.data.data.accounts : [];
      setAccounts(list);
      if (scope.clientId) {
        const liveResponse = await api.get('/meta/live/accounts', { params: { clientId: scope.clientId, ...(scope.businessId ? { businessId: scope.businessId } : {}), ...(scope.adAccountId ? { adAccountId: scope.adAccountId } : {}), force: force ? 'true' : 'false' } });
        const rows: LiveAccount[] = Array.isArray(liveResponse.data?.data?.rows) ? liveResponse.data.data.rows : [];
        setLive(Object.fromEntries(rows.map((item) => [item.id,item])));
      } else setLive({});
    } catch (e:any) { setError(e?.response?.data?.error?.message || 'Não foi possível carregar as contas Meta.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(false); }, [scope.clientId,scope.businessId,scope.adAccountId]);

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
      await load(true);
      window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
    } catch (e:any) { setError(e?.response?.data?.error?.message || 'Não foi possível alterar a autorização desta conta.'); }
    finally { setSaving(''); }
  }

  return <div className="space-y-4">
    <section className="page-heading"><div><p className="section-kicker">Estrutura Meta</p><h1>Contas Meta</h1><p>Contas separadas por Business Manager, com saldo/cobrança e saúde financeira consultados diretamente na Meta.</p></div><button className="secondary-button" onClick={() => { void load(true); }} disabled={loading}><RefreshCw size={14} className={loading?'animate-spin':''} />Atualizar agora</button></section>
    {error && <div className="message-warning">{error}</div>}
    <div className="corporate-card flex items-start gap-3 p-4"><span className="metric-icon"><WalletCards size={15}/></span><div><h2 className="panel-title">Cobranças e pagamentos</h2><p className="panel-subtitle">Para contas pré-pagas, o saldo é exibido como disponível. Em contas pós-pagas, a Meta pode retornar saldo/cobrança e limite de gasto com significados diferentes; a plataforma identifica cada campo sem estimar valores.</p></div></div>
    <div className="space-y-3">{grouped.map((group) => <section key={group.businessId} className="corporate-card overflow-hidden"><header className="flex flex-col gap-2 border-b border-[#e2e7e4] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="metric-icon"><ShieldCheck size={15} /></span><div><h2 className="panel-title">{group.name}</h2><p className="panel-subtitle">ID: {group.businessId === '__SEM_BM__' ? 'não identificado' : group.businessId} · {group.rows.filter((row) => row.isAssigned).length} de {group.rows.length} autorizada(s)</p></div></div></header><div className="table-scroll"><table className="corporate-table"><thead><tr><th>Conta</th><th>ID</th><th>Saldo / cobrança</th><th>Limite restante</th><th>Status financeiro</th><th>Moeda</th><th>Meta</th><th>Dashboard</th><th>Atualizado</th><th>Ação</th></tr></thead><tbody>{group.rows.sort((a,b) => String(a.name||a.accountId).localeCompare(String(b.name||b.accountId))).map((account) => { const financial = live[account.id]; return <tr key={account.id}><td><strong>{account.name || 'Conta sem nome'}</strong>{financial?.balanceLabel && <small>{financial.balanceLabel}</small>}</td><td>{account.accountId}</td><td><strong>{financial?.error ? 'Indisponível' : money(financial?.balance, financial?.currency || account.currency)}</strong>{financial?.isPrepayAccount === true && <small>Pré-paga</small>}{financial?.isPrepayAccount === false && <small>Pós-paga</small>}</td><td>{money(financial?.remainingSpendLimit, financial?.currency || account.currency)}{financial?.spendCap != null && <small>Limite: {money(financial.spendCap, financial.currency || account.currency)}</small>}</td><td>{financial?.error ? <span className="status-chip border-amber-200 bg-amber-50 text-amber-700"><AlertTriangle size={12}/>Não disponível</span> : <span className={`status-chip ${statusClasses(financial?.severity)}`}>{financial?.severity === 'danger' ? <AlertTriangle size={12}/> : <CheckCircle2 size={12}/>} {financial?.financialStatusLabel || 'Consultando Meta'}</span>}</td><td>{account.currency || '—'}</td><td><span className={`status-chip ${account.isActive ? 'status-success':'status-neutral'}`}>{account.isActive ? <CheckCircle2 size={12}/>:<Unlink size={12}/>} {account.isActive ? 'Conectada':'Desconectada'}</span></td><td><span className={`status-chip ${account.isAssigned?'status-success':'status-neutral'}`}>{account.isAssigned?'Autorizada':'Fora do dashboard'}</span></td><td>{financial?.updatedAt ? new Date(financial.updatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—'}</td><td>{canAdmin ? <button className={account.isAssigned?'secondary-button':'primary-button'} disabled={saving===account.id || !account.isActive} onClick={() => { void toggle(account); }}>{account.isAssigned?<Unlink size={13}/>:<Link2 size={13}/>} {saving===account.id?'Salvando':account.isAssigned?'Remover':'Autorizar'}</button>:<span className="text-[10px] text-slate-400">Somente administrador</span>}</td></tr>; })}</tbody></table></div></section>)}{!grouped.length && !loading && <div className="corporate-card empty-state"><CreditCard size={20}/><span>Nenhuma conta encontrada para o escopo selecionado.</span></div>}</div>
  </div>;
}
