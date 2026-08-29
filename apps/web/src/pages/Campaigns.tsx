import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../store';

const money = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const number = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR');

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

type MetaAccount = {
  id: string;
  clientId: string;
  accountId: string;
  name?: string | null;
  currency?: string | null;
  accountStatus?: number | null;
};

export default function Campaigns() {
  const user = useAuth((state) => state.user);
  const canManage = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [accounts, setAccounts] = useState<MetaAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [changingId, setChangingId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('OUTCOME_LEADS');
  const [adAccountId, setAdAccountId] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [specialCategory, setSpecialCategory] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setError('');
    try {
      const [campaignResponse, metaResponse] = await Promise.all([
        api.get('/dashboard/campaigns'),
        api.get('/meta/status').catch(() => null),
      ]);
      setRows(Array.isArray(campaignResponse.data.data) ? campaignResponse.data.data : []);
      const nextAccounts = metaResponse?.data?.data?.accounts;
      const availableAccounts = Array.isArray(nextAccounts) ? nextAccounts : [];
      setAccounts(availableAccounts);
      setAdAccountId((current) => current || String(availableAccounts[0]?.id || ''));
    } catch {
      setError('Não foi possível carregar as campanhas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !adAccountId || !name.trim()) return;

    setCreating(true);
    setError('');
    setNotice('');
    try {
      await api.post('/campaigns', {
        adAccountId,
        name: name.trim(),
        objective,
        ...(dailyBudget ? { dailyBudget: Number(dailyBudget.replace(',', '.')) } : {}),
        specialAdCategories: specialCategory ? [specialCategory] : [],
      });
      setName('');
      setDailyBudget('');
      setSpecialCategory('');
      setShowCreate(false);
      setNotice('Campanha criada diretamente na Meta em modo pausado. Revise a configuração antes de ativar.');
      await load();
    } catch (requestError: any) {
      const message = requestError?.response?.data?.message;
      setError(message || 'A campanha não foi criada. Verifique as permissões da Meta e os dados informados.');
    } finally {
      setCreating(false);
    }
  }

  async function changeStatus(campaign: Record<string, any>) {
    const nextStatus = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setChangingId(String(campaign.id));
    setError('');
    setNotice('');
    try {
      await api.post(`/campaigns/${campaign.id}/status`, { status: nextStatus });
      setNotice(nextStatus === 'ACTIVE' ? 'Campanha ativada na Meta.' : 'Campanha pausada na Meta.');
      await load();
    } catch (requestError: any) {
      const message = requestError?.response?.data?.message;
      setError(message || 'A Meta não aceitou a alteração de status desta campanha.');
    } finally {
      setChangingId('');
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="mt-1 text-sm text-slate-500">Acompanhe os resultados e gerencie campanhas reais da conta conectada.</p>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="px-4 py-2 rounded-lg bg-brand-blue text-sm font-bold text-white hover:bg-brand-purple"
            >
              {showCreate ? 'Fechar' : 'Nova campanha'}
            </button>
          )}
          <button onClick={() => { setLoading(true); void load(); }} className="px-3 py-2 rounded-lg border border-brand-border text-sm text-slate-600 hover:bg-black/5">Atualizar</button>
        </div>
      </div>

      {showCreate && canManage && (
        <form onSubmit={createCampaign} className="mb-4 rounded-xl border border-brand-border bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="font-bold text-slate-900">Criar campanha na Meta Ads</h2>
            <p className="mt-1 text-xs text-slate-500">Por segurança, toda nova campanha é criada pausada. A ativação é feita somente após sua revisão.</p>
          </div>

          {!accounts.length ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">Nenhuma conta de anúncio está conectada. Conecte a Meta Ads na área de Clientes antes de criar a campanha.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-sm font-medium text-slate-700">
                Conta de anúncio
                <select value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)} required className="mt-1 w-full rounded-lg border border-brand-border bg-white px-3 py-2 outline-none focus:border-brand-blue">
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name || account.accountId}{account.currency ? ` · ${account.currency}` : ''}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-medium text-slate-700 md:col-span-1 xl:col-span-2">
                Nome da campanha
                <input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={200} required placeholder="Ex.: Leads WhatsApp Joinville" className="mt-1 w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-blue" />
              </label>

              <label className="text-sm font-medium text-slate-700">
                Objetivo
                <select value={objective} onChange={(event) => setObjective(event.target.value)} className="mt-1 w-full rounded-lg border border-brand-border bg-white px-3 py-2 outline-none focus:border-brand-blue">
                  {objectives.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>

              <label className="text-sm font-medium text-slate-700">
                Orçamento diário
                <input value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} inputMode="decimal" placeholder="Opcional" className="mt-1 w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-blue" />
                <span className="mt-1 block text-[11px] font-normal text-slate-400">Valor na moeda configurada na conta.</span>
              </label>

              <label className="text-sm font-medium text-slate-700">
                Categoria especial
                <select value={specialCategory} onChange={(event) => setSpecialCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-brand-border bg-white px-3 py-2 outline-none focus:border-brand-blue">
                  {specialCategories.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
                </select>
              </label>

              <div className="md:col-span-2 xl:col-span-3 flex justify-end">
                <button disabled={creating} className="rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-purple disabled:opacity-50">
                  {creating ? 'Criando na Meta...' : 'Criar campanha pausada'}
                </button>
              </div>
            </div>
          )}
        </form>
      )}

      {notice && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}

      <div className="bg-white border border-brand-border rounded-xl p-4">
        {loading ? (
          <p className="text-sm text-slate-500">Carregando campanhas...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] text-sm">
              <thead className="text-slate-500 text-left">
                <tr><th className="py-2">Nome</th><th>Objetivo</th><th>Status</th><th>Investimento</th><th>Impressões</th><th>Leads</th><th>Conversas</th><th>CPC</th>{canManage && <th className="text-right">Ação</th>}</tr>
              </thead>
              <tbody>
                {rows.map((campaign) => (
                  <tr key={String(campaign.id)} className="border-t border-brand-border">
                    <td className="py-3 font-medium text-slate-900">{campaign.name}</td>
                    <td>{campaign.objective || '-'}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${campaign.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {campaign.status || '-'}
                      </span>
                    </td>
                    <td>{money(campaign.spend)}</td>
                    <td>{number(campaign.impressions)}</td>
                    <td>{number(campaign.leads)}</td>
                    <td>{number(campaign.conversations)}</td>
                    <td>{money(campaign.cpc)}</td>
                    {canManage && (
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => { void changeStatus(campaign); }}
                          disabled={changingId === String(campaign.id)}
                          className="rounded-lg border border-brand-border px-3 py-2 text-xs font-bold text-brand-blue transition hover:bg-[#eef4eb] disabled:opacity-50"
                        >
                          {changingId === String(campaign.id) ? 'Salvando...' : campaign.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !rows.length && !error && <p className="py-5 text-sm text-slate-500">Nenhuma campanha sincronizada.</p>}
      </div>
    </div>
  );
}
