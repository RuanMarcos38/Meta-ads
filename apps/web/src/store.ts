import { create } from 'zustand';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  clientId?: string | null;
  businessId?: string | null;
  mustChangePassword?: boolean;
}

interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
}

export type ScopeClient = { id: string; name: string; companyName?: string | null; email?: string | null; phone?: string | null; status?: string; _count?: { users: number; adAccounts: number; businessManagers: number } };
export type ScopeBusiness = { id: string; clientId: string; metaBusinessId: string; name: string; adminEmail?: string | null; status: string; connectionStatus?: string; tokenStatus?: string };
export type ScopeAccount = { id: string; clientId: string; businessManagerId?: string | null; businessId?: string | null; businessName?: string | null; accountId: string; name?: string | null; currency?: string | null; timezone?: string | null; accountStatus?: number | null; isActive: boolean; isAssigned: boolean };

interface ScopeState {
  clientId: string;
  businessId: string;
  adAccountId: string;
  clients: ScopeClient[];
  businesses: ScopeBusiness[];
  accounts: ScopeAccount[];
  tenantLocked: boolean;
  setClientId: (value: string) => void;
  setBusinessId: (value: string) => void;
  setAdAccountId: (value: string) => void;
  setContext: (input: { clients: ScopeClient[]; businesses: ScopeBusiness[]; accounts: ScopeAccount[]; tenantLocked?: boolean; selectedClientId?: string | null; selectedBusinessId?: string | null }) => void;
  clearScope: () => void;
}

function readStoredUser(): User | null {
  try {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) as User : null;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
}

function stored(key: string) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

export const useAuth = create<AuthState>((set) => ({
  user: readStoredUser(),
  setUser: (user) => {
    if (user) localStorage.setItem('user', JSON.stringify(user));
    else localStorage.removeItem('user');
    set({ user });
  },
}));

export const useScope = create<ScopeState>((set, get) => ({
  clientId: stored('gestaoAdsClientId'),
  businessId: stored('gestaoAdsBusinessId'),
  adAccountId: stored('gestaoAdsAdAccountId'),
  clients: [],
  businesses: [],
  accounts: [],
  tenantLocked: false,
  setClientId: (value) => {
    if (value) localStorage.setItem('gestaoAdsClientId', value); else localStorage.removeItem('gestaoAdsClientId');
    localStorage.removeItem('gestaoAdsBusinessId');
    localStorage.removeItem('gestaoAdsAdAccountId');
    set({ clientId: value, businessId: '', adAccountId: '' });
  },
  setBusinessId: (value) => {
    if (value) localStorage.setItem('gestaoAdsBusinessId', value); else localStorage.removeItem('gestaoAdsBusinessId');
    localStorage.removeItem('gestaoAdsAdAccountId');
    set({ businessId: value, adAccountId: '' });
  },
  setAdAccountId: (value) => {
    if (value) localStorage.setItem('gestaoAdsAdAccountId', value); else localStorage.removeItem('gestaoAdsAdAccountId');
    set({ adAccountId: value });
  },
  setContext: (input) => {
    const current = get();
    const clientId = input.selectedClientId
      || (input.clients.some((item) => item.id === current.clientId) ? current.clientId : input.clients[0]?.id)
      || '';
    const allowedBusinesses = input.businesses.filter((item) => item.clientId === clientId);
    const businessId = input.selectedBusinessId
      || (allowedBusinesses.some((item) => item.metaBusinessId === current.businessId) ? current.businessId : allowedBusinesses[0]?.metaBusinessId)
      || '';
    const allowedAccounts = input.accounts.filter((item) => item.clientId === clientId && (!businessId || item.businessId === businessId) && item.isAssigned && item.isActive);
    const adAccountId = allowedAccounts.some((item) => item.id === current.adAccountId) ? current.adAccountId : '';
    if (clientId) localStorage.setItem('gestaoAdsClientId', clientId);
    if (businessId) localStorage.setItem('gestaoAdsBusinessId', businessId);
    else localStorage.removeItem('gestaoAdsBusinessId');
    if (adAccountId) localStorage.setItem('gestaoAdsAdAccountId', adAccountId);
    else localStorage.removeItem('gestaoAdsAdAccountId');
    set({
      clientId,
      businessId,
      adAccountId,
      clients: input.clients,
      businesses: input.businesses,
      accounts: input.accounts,
      tenantLocked: Boolean(input.tenantLocked),
    });
  },
  clearScope: () => {
    localStorage.removeItem('gestaoAdsClientId');
    localStorage.removeItem('gestaoAdsBusinessId');
    localStorage.removeItem('gestaoAdsAdAccountId');
    set({ clientId: '', businessId: '', adAccountId: '', clients: [], businesses: [], accounts: [], tenantLocked: false });
  },
}));
