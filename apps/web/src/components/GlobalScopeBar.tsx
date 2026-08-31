import { useEffect, useMemo, useState } from 'react';
import { Building2, BriefcaseBusiness, CreditCard, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth, useScope, type ScopeClient } from '../store';

function contactKey(client: ScopeClient) {
  const email = client.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = client.phone?.replace(/\D/g, '');
  if (phone) return `phone:${phone}`;
  return `company:${client.id}`;
}

function contactLabel(client: ScopeClient) {
  return client.email?.trim() || client.phone?.trim() || client.name;
}

export default function GlobalScopeBar() {
  const user = useAuth((state) => state.user);
  const scope = useScope();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/workspace/context');
      const data = response.data?.data || {};
      scope.setContext({
        clients: Array.isArray(data.clients) ? data.clients : [],
        businesses: Array.isArray(data.businesses) ? data.businesses : [],
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
        tenantLocked: Boolean(data.tenantLocked),
        selectedClientId: data.selectedClientId,
        selectedBusinessId: data.selectedBusinessId,
      });
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || requestError?.response?.data?.message || 'Não foi possível carregar empresas e Gerenciadores de Negócios.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshFromMeta() {
    setLoading(true);
    setError('');
    try {
      if (isAdmin) {
        await api.post('/workspace/business-managers/import-from-meta', {
          ...(scope.clientId ? { clientId: scope.clientId } : {}),
        });
      }
      const response = await api.get('/workspace/context');
      const data = response.data?.data || {};
      scope.setContext({
        clients: Array.isArray(data.clients) ? data.clients : [],
        businesses: Array.isArray(data.businesses) ? data.businesses : [],
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
        tenantLocked: Boolean(data.tenantLocked),
        selectedClientId: data.selectedClientId,
        selectedBusinessId: data.selectedBusinessId,
      });
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error?.message || requestError?.response?.data?.message || 'Não foi possível atualizar os Gerenciadores de Negócios pela Meta.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const handler = () => { void load(); };
    window.addEventListener('gestao-ads:scope-refresh', handler);
    return () => window.removeEventListener('gestao-ads:scope-refresh', handler);
  }, []);

  const businesses = useMemo(
    () => scope.businesses.filter((item) => item.clientId === scope.clientId),
    [scope.businesses, scope.clientId],
  );
  const accounts = useMemo(
    () => scope.accounts.filter((item) => item.clientId === scope.clientId && item.isAssigned && item.isActive && (!scope.businessId || item.businessId === scope.businessId)),
    [scope.accounts, scope.clientId, scope.businessId],
  );
  const clientGroups = useMemo(() => {
    const map = new Map<string, ScopeClient[]>();
    for (const client of scope.clients) {
      const key = contactKey(client);
      const list = map.get(key) || [];
      list.push(client);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([key, clients]) => ({ key, clients: [...clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) }))
      .sort((a, b) => contactLabel(a.clients[0]).localeCompare(contactLabel(b.clients[0]), 'pt-BR'));
  }, [scope.clients]);

  return (
    <div className="scope-bar border-b border-[#e2e7e4] bg-[#fafbfa] px-3 py-2.5 sm:px-4 md:px-6">
      <div className="flex min-w-0 flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
          <label className="relative min-w-0">
            <span className="sr-only">Empresa</span>
            <Building2 size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={scope.clientId} disabled={scope.tenantLocked} onChange={(event) => scope.setClientId(event.target.value)} className="scope-select h-9 w-full min-w-0 rounded-[7px] border border-[#d9e0dc] bg-white pl-8 pr-7 text-[11px] font-medium text-slate-700 outline-none focus:border-[#93c5fd] disabled:bg-[#f2f4f2]">
              {!scope.clients.length && <option value="">Nenhuma empresa</option>}
              {clientGroups.map((group) => group.clients.length > 1
                ? <optgroup key={group.key} label={`Cliente · ${contactLabel(group.clients[0])}`}>
                    {group.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </optgroup>
                : group.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>))}
            </select>
          </label>
          <label className="relative min-w-0">
            <span className="sr-only">Gerenciador de Negócios</span>
            <BriefcaseBusiness size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={scope.businessId} disabled={scope.tenantLocked} onChange={(event) => scope.setBusinessId(event.target.value)} className="scope-select h-9 w-full min-w-0 rounded-[7px] border border-[#d9e0dc] bg-white pl-8 pr-7 text-[11px] font-medium text-slate-700 outline-none focus:border-[#93c5fd] disabled:bg-[#f2f4f2]">
              {!businesses.length && <option value="">Gerenciador não vinculado</option>}
              {!scope.tenantLocked && <option value="">Todos os Gerenciadores de Negócios</option>}
              {businesses.map((business) => <option key={business.id} value={business.metaBusinessId}>{business.name}</option>)}
            </select>
          </label>
          <label className="relative min-w-0">
            <span className="sr-only">Conta de anúncios</span>
            <CreditCard size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={scope.adAccountId} onChange={(event) => scope.setAdAccountId(event.target.value)} className="scope-select h-9 w-full min-w-0 rounded-[7px] border border-[#d9e0dc] bg-white pl-8 pr-7 text-[11px] font-medium text-slate-700 outline-none focus:border-[#93c5fd]">
              <option value="">Todas as contas autorizadas</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.accountId}</option>)}
            </select>
          </label>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 xl:justify-end">
          {error ? <span className="scope-feedback text-[10px] font-medium text-amber-700">{error}</span> : <span className="scope-feedback text-[10px] text-slate-400">Escopo aplicado em toda a plataforma</span>}
          <button type="button" onClick={() => { void refreshFromMeta(); }} disabled={loading} className="grid h-9 w-9 place-items-center rounded-[7px] border border-[#d9e0dc] bg-white text-slate-500 hover:border-[#bfdbfe] hover:bg-[#eff6ff] hover:text-[#2563eb] disabled:opacity-50" title={isAdmin ? 'Buscar novamente os Gerenciadores de Negócios e contas na Meta' : 'Atualizar empresas e Gerenciadores de Negócios'}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
    </div>
  );
}
