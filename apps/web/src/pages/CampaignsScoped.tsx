import { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../store';

type ClientOption = { id: string; name: string };
type BusinessOption = { id: string; name: string; clientId: string };
type AccountOption = {
  id: string;
  clientId: string;
  accountId: string;
  name?: string | null;
  currency?: string | null;
  businessId?: string | null;
  businessName?: string | null;
  isActive: boolean;
};
type Context = {
  selectedClientId?: string | null;
  clients: ClientOption[];
  businesses: BusinessOption[];
  accounts: AccountOption[];
  tenantLocked: boolean;
};

type CampaignRow = Record<string, any> & {
  id: string;
  name: string;
  status?: string | null;
  spend?: number;
  impressions?: number;
  leads?: number;
  conversations?: number;
  cpc?: number;
  adAccount?: AccountOption;
};

const objectives = [
  ['OUTCOME_LEADS', 'Leads'],
  ['OUTCOME_TRAFFIC', 'Tráfego'],
  ['OUTCOME_ENGAGEMENT', 'Engajamento'],
  ['OUTCOME_SALES', 'Vendas'],
  ['OUTCOME_AWARENESS', 'Reconhecimento'],
  ['OUTCOME_APP_PROMOTION', 'Promoção do app'],
] as const;

const specialCategories = [
  ['', 'Nenhuma categoria especial'],
  ['HOUSING', 'Habitação'],
  ['EMPLOYMENT', 'Emprego'],
  ['CREDIT', 'Crédito'],
  ['ISSUES_ELECTIONS_POLITICS', 'Questões sociais, eleições ou política'],
] as const;

const money = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const number = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR');

export default function CampaignsScoped() {
  const user = useAuth((state) => state.user);
  const canManage = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const [context, setContext] = useState<Context | null>(null);
  const [clientId, setClientId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [changingId, setChangingId] = useState('');
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('OUTCOME_LEADS');
  const [createAccountId, setCreateAccountId] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [specialCategory, setSpecialCategory] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadContext() {
    const response = await api.get('/dashboard/context');
    const data = response.data?.data as Context;
    setContext(data);
    const saved = localStorage.getItem('gestaoAdsClientId') || '';
    const initial = data.selectedClientId || (data.clients.some((client) => client.id === saved) ? saved : data.clients[0]?.id) || '';
    setClientId(initial);
    if (initial) localStorage.setItem('gestaoAdsClientId', initial);
  }

  async function loadCampaigns() {
    if (!clientId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/dashboard/scoped/campaigns', {
        params: {
          clientId,
          ...(businessId ? { businessId } : {}),
          ...(filterAccountId ? { adAccountId: filterAccountId } : {}),
        },
      });
      setRows(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível carregar as campanhas desta empresa.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadContext().catch(() => {
      setError('Não foi possível carregar as empresas e contas disponíveis.');
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!context || !clientId) return;
    void loadCampaigns();
  }, [context, clientId, businessId, filterAccountId]);

  const businesses = useMemo(
    () => (context?.businesses ?? []).filter((item) => item.clientId === clientId),
    [context, clientId],
  );
  const accounts = useMemo(
    () => (context?.accounts ?? []).filter((item) => item.clientId === clientId && item.isActive && (!businessId || item.businessId === businessId)),
    [context, clientId, businessId],
  );

  useEffect(() => {
    if (!accounts.some((account) => account.id === createAccountId)) {
      setCreateAccountId(accounts[0]?.id || '');
    }
  }, [accounts, createAccountId]);

  function changeClient(value: string) {
    setClientId(value);
    setBusinessId('');
    setFilterAccountId('');
    setCreateAccountId('');
    if (value) localStorage.setItem('gestaoAdsClientId', value);
  }

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !createAccountId || !name.trim()) return;
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await api.post('/campaigns', {
        adAccountId: createAccountId,
        name: name.trim(),
        objective,
        ...(dailyBudget ? { dailyBudget: Number(dailyBudget.replace(',', '.')) } : {}),
        specialAdCategories: specialCategory ? [specialCategory] : [],
      });
      setName('');
      setDailyBudget('');
      setSpecialCategory('');
      setShowCreate(false);
      setNotice('Campanha criada na Meta em modo pausado. Revise antes de ativar.');
      await loadCampaigns();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'A campanha não foi criada. Verifique a permissão da conta Meta.');
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(campaign: CampaignRow) {
    const nextStatus = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setChangingId(String(campaign.id));
    setError('');
    setNotice('');
    try {
      await api.post(`/campaigns/${campaign.id}/status`, { status: nextStatus });
      setNotice(nextStatus === 'ACTIVE' ? 'Campanha ativada na Meta.' : 'Campanha pausada na Meta.');
      await loadCampaigns();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'A Meta não aceitou a alteração desta campanha.');
    } finally {
      setChangingId('');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">Operação</p>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[#16231b]">Campanhas</h1>
          <p className="mt-1 text-[13px] text-slate-500">Acompanhe e gerencie campanhas dentro do escopo da empresa e conta selecionadas.</p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <button type="button" onClick={() => setShowCreate((value) => !value)} className="inline-flex h-10 items-center gap-2 rounded-[9px] bg-[#176846] px-4 text-sm font-semibold text-white hover:bg-[#12563a]">
              <Plus size={15} /> {showCreate ? 'Fechar' : 'Nova campanha'}
            </button>
          )}
          <button type="button" onClick={() => { void loadCampaigns(); }} className="inline-flex h-10 items-center gap-2 rounded-[9px] border border-[#d9e0db] bg-white px-3.5 text-sm font-semibold text-slate-600 hover:bg-[#f7f9f7]">
            <RefreshCw size={14} /> Atualizar
          </button>
        </div>
      </div>

      <section className="rounded-[12px] border border-[#dfe5e1] bg-[#fafbfa] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1c2b22]"><Building2 size={16} className="text-[#176846]" /> Escopo das campanhas</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Empresa
            <select value={clientId} onChange={(event) => changeClient(event.target.value)} disabled={Boolean(context?.tenantLocked)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none disabled:bg-[#f2f4f2]">
              {(context?.clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Business Manager
            <select value={businessId} onChange={(event) => { setBusinessId(event.target.value); setFilterAccountId(''); }} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none">
              <option value="">Todas as BMs</option>
              {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-500">Conta Meta Ads
            <select value={filterAccountId} onChange={(event) => setFilterAccountId(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm font-medium normal-case tracking-normal outline-none">
              <option value="">Todas as contas</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.accountId}</option>)}
            </select>
          </label>
        </div>
      </section>

      {showCreate && canManage && (
        <form onSubmit={createCampaign} className="rounded-[12px] border border-[#dfe5e1] bg-white p-4.5">
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold text-[#17251c]">Criar campanha na Meta Ads</h2>
            <p className="mt-1 text-[11px] text-slate-500">A campanha é criada pausada para revisão antes da ativação.</p>
          </div>
          {!accounts.length ? (
            <p className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Nenhuma conta ativa está disponível para esta empresa/BM.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">Conta de anúncio
                <select value={createAccountId} onChange={(event) => setCreateAccountId(event.target.value)} required className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none">
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.businessName ? `${account.businessName} · ` : ''}{account.name || account.accountId}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 md:col-span-1 xl:col-span-2">Nome da campanha
                <input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={200} required className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] px-3 text-sm outline-none" placeholder="Ex.: Leads WhatsApp Joinville" />
              </label>
              <label className="text-xs font-semibold text-slate-600">Objetivo
                <select value={objective} onChange={(event) => setObjective(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none">
                  {objectives.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Orçamento diário
                <input value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} inputMode="decimal" className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] px-3 text-sm outline-none" placeholder="Opcional" />
              </label>
              <label className="text-xs font-semibold text-slate-600">Categoria especial
                <select value={specialCategory} onChange={(event) => setSpecialCategory(event.target.value)} className="mt-1.5 h-10 w-full rounded-[8px] border border-[#d9e0db] bg-white px-3 text-sm outline-none">
                  {specialCategories.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
                </select>
              </label>
              <div className="md:col-span-2 xl:col-span-3 flex justify-end">
                <button disabled={creating} className="h-10 rounded-[8px] bg-[#176846] px-5 text-sm font-semibold text-white disabled:opacity-50">{creating ? 'Criando...' : 'Criar campanha pausada'}</button>
              </div>
            </div>
          )}
        </form>
      )}

      {notice && <p className="rounded-[9px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">{notice}</p>}
      {error && <p className="rounded-[9px] border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">{error}</p>}

      <section className="overflow-hidden rounded-[12px] border border-[#dfe5e1] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="bg-[#fafbfa] text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              <tr><th className="px-4 py-3">Campanha</th><th className="px-3 py-3">BM / Conta</th><th className="px-3 py-3">Objetivo</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Investimento</th><th className="px-3 py-3">Impressões</th><th className="px-3 py-3">Leads</th><th className="px-3 py-3">Conversas</th><th className="px-3 py-3">CPC</th>{canManage && <th className="px-4 py-3 text-right">Ação</th>}</tr>
            </thead>
            <tbody>
              {rows.map((campaign) => (
                <tr key={campaign.id} className="border-t border-[#eef1ef] text-[13px]">
                  <td className="px-4 py-3.5 font-semibold text-[#1a2820]">{campaign.name}</td>
                  <td className="px-3 py-3.5 text-slate-500">{campaign.adAccount?.businessName || 'BM não identificado'} · {campaign.adAccount?.name || campaign.adAccount?.accountId || '-'}</td>
                  <td className="px-3 py-3.5 text-slate-500">{campaign.objective || '-'}</td>
                  <td className="px-3 py-3.5"><span className={`inline-flex rounded-[6px] px-2 py-1 text-[11px] font-semibold ${campaign.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{campaign.status || '-'}</span></td>
                  <td className="px-3 py-3.5 tabular-nums">{money(campaign.spend)}</td>
                  <td className="px-3 py-3.5 tabular-nums">{number(campaign.impressions)}</td>
                  <td className="px-3 py-3.5 tabular-nums">{number(campaign.leads)}</td>
                  <td className="px-3 py-3.5 tabular-nums">{number(campaign.conversations)}</td>
                  <td className="px-3 py-3.5 tabular-nums">{money(campaign.cpc)}</td>
                  {canManage && <td className="px-4 py-3.5 text-right"><button type="button" onClick={() => { void changeStatus(campaign); }} disabled={changingId === campaign.id} className="rounded-[7px] border border-[#d5ddd7] px-3 py-1.5 text-xs font-semibold text-[#176846] hover:bg-[#f3f7f4] disabled:opacity-50">{changingId === campaign.id ? 'Salvando...' : campaign.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p className="px-4 py-7 text-sm text-slate-500">Carregando campanhas...</p>}
        {!loading && !rows.length && !error && <p className="px-4 py-7 text-sm text-slate-500">Nenhuma campanha encontrada neste escopo.</p>}
      </section>
    </div>
  );
}
