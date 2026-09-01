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
    () => scope.businesses.filter((item) => item.clientId === scope.clientId && item.status !== 'inactive'),
    [scope.businesses, scope.clientId],
  );
  const accounts = useMemo(
    () => scope.accounts.filter((item) => item.clientId === scope.clientId && item.isAssigned && item.isActive && (!scope.businessId || item.businessId === scope.businessId)),
    [scope.accounts, scope.clientId, scope.businessId],
  );

  useEffect(() => {
    if (!businesses.length) return;
    if (!businesses.some((item) => item.metaBusinessId === scope.businessId)) {
      scope.setBusinessId(businesses[0].metaBusinessId);
    }
  }, [businesses, scope.businessId]);

  useEffect(() => {
    if (!accounts.length) return;
    if (!accounts.some((item) => item.id === scope.adAccountId)) {
      scope.setAdAccountId(accounts[0].id);
    }
  }, [accounts, scope.adAccountId]);

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

  const scopeCounts = useMemo(() => {
    const map = new Map<string, { businesses: number; accounts: number }>();
    for (const client of scope.clients) map.set(client.id, { businesses: 0, accounts: 0 });
    for (const business of scope.businesses) {
      if (business.status === 'inactive') continue;
      const current = map.get(business.clientId) || { businesses: 0, accounts: 0 };
      current.businesses += 1;
      map.set(business.clientId, current);
    }
    for (const account of scope.accounts) {
      if (!account.isAssigned || !account.isActive) continue;
      const current = map.get(account.clientId) || { businesses: 0, accounts: 0 };
      current.accounts += 1;
      map.set(account.clientId, current);
    }
    return map;
  }, [scope.clients, scope.businesses, scope.accounts]);

  function companyLabel(client: ScopeClient) {
    const counts = scopeCounts.get(client.id) || { businesses: 0, accounts: 0 };
    if (!counts.businesses && !counts.accounts) return client.name;
    return `${client.name} · ${counts.businesses} BM${counts.businesses === 1 ? '' : 's'} · ${counts.accounts} conta${counts.accounts === 1 ? '' : 's'}`;
  }

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
                    {group.clients.map((client) => <option key={client.id} value={client.id}>{companyLabel(client)}</option>)}
                  </optgroup>
                : group.clients.map((client) => <option key={client.id} value={client.id}>{companyLabel(client)}</option>))}
            </select>
          </label>
          <label className="relative min-w-0">
            <span className="sr-only">Gerenciador de Negócios</span>
            <BriefcaseBusiness size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={scope.businessId} disabled={scope.tenantLocked || !businesses.length} onChange={(event) => scope.setBusinessId(event.target.value)} className="scope-select h-9 w-full min-w-0 rounded-[7px] border border-[#d9e0dc] bg-white pl-8 pr-7 text-[11px] font-medium text-slate-700 outline-none focus:border-[#93c5fd] disabled:bg-[#f2f4f2]">
              {!businesses.length && <option value="">BM não vinculada</option>}
              {businesses.map((business) => <option key={business.id} value={business.metaBusinessId}>{business.name}</option>)}
            </select>
          </label>
          <label className="relative min-w-0">
            <span className="sr-only">Conta de anúncios</span>
            <CreditCard size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={scope.adAccountId} disabled={!accounts.length} onChange={(event) => scope.setAdAccountId(event.target.value)} className="scope-select h-9 w-full min-w-0 rounded-[7px] border border-[#d9e0dc] bg-white pl-8 pr-7 text-[11px] font-medium text-slate-700 outline-none focus:border-[#93c5fd] disabled:bg-[#f2f4f2]">
              {!accounts.length && <option value="">Conta não vinculada</option>}
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.accountId}</option>)}
            </select>
          </label>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 xl:justify-end">
          {error ? <span className="scope-feedback text-[10px] font-medium text-amber-700">{error}</span> : <span className="scope-feedback text-[10px] text-slate-400">Escopo separado por empresa, BM e conta</span>}
          <button type="button" onClick={() => { void refreshFromMeta(); }} disabled={loading} className="grid h-9 w-9 place-items-center rounded-[7px] border border-[#d9e0dc] bg-white text-slate-500 hover:border-[#bfdbfe] hover:bg-[#eff6ff] hover:text-[#2563eb] disabled:opacity-50" title={isAdmin ? 'Atualizar somente as BMs já vinculadas desta empresa' : 'Atualizar empresa, BM e conta'}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
    </div>
  );
}
