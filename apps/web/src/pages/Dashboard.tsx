import { useEffect, useState } from 'react';
import { api } from '../api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const asNumber = (value: unknown) => Number(value ?? 0);
const fmt = (value: unknown, currency = false) => {
  const number = asNumber(value);
  return currency
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : number.toLocaleString('pt-BR');
};

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-brand-card border border-brand-border rounded-xl p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [daily, setDaily] = useState<Record<string, unknown>[]>([]);
  const [campaigns, setCampaigns] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [summaryResponse, dailyResponse, campaignsResponse] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/dashboard/daily'),
        api.get('/dashboard/campaigns'),
      ]);
      setSummary(summaryResponse.data.data ?? {});
      setDaily(Array.isArray(dailyResponse.data.data) ? dailyResponse.data.data : []);
      setCampaigns(Array.isArray(campaignsResponse.data.data) ? campaignsResponse.data.data : []);
    } catch {
      setError('Não foi possível carregar os indicadores. Verifique a conexão com a API e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function sync() {
    setSyncing(true);
    setError('');
    try {
      await api.post('/dashboard/sync', {});
      await load();
    } catch {
      setError('A sincronização não foi concluída. Confira a integração com a Meta Ads.');
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <p className="text-gray-400">Carregando indicadores...</p>;

  if (!summary) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-red-300">{error || 'Os dados do dashboard não estão disponíveis.'}</p>
        <button onClick={() => { setLoading(true); void load(); }} className="mt-3 px-4 py-2 rounded-lg bg-brand-blue text-sm font-medium">Tentar novamente</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <h1 className="text-2xl font-bold">Dashboard Executivo</h1>
        <button
          onClick={sync}
          disabled={syncing}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-blue to-brand-purple font-medium text-sm disabled:opacity-50"
        >
          {syncing ? 'Atualizando...' : 'Atualizar Dados'}
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300" role="alert">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card label="Investimento" value={fmt(summary.spend, true)} />
        <Card label="Leads" value={fmt(summary.leads)} />
        <Card label="Conversas" value={fmt(summary.conversations)} />
        <Card label="Custo/Lead" value={fmt(summary.costPerLead, true)} />
        <Card label="Impressões" value={fmt(summary.impressions)} />
        <Card label="Alcance" value={fmt(summary.reach)} />
        <Card label="CTR" value={`${asNumber(summary.ctr).toFixed(2)}%`} />
        <Card label="CPC" value={fmt(summary.cpc, true)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-brand-card border border-brand-border rounded-xl p-4">
          <p className="text-sm text-gray-300 mb-3">Investimento diário</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={daily}>
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip contentStyle={{ background: '#141a2b', border: '1px solid #232b40' }} />
              <Line type="monotone" dataKey="spend" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-brand-card border border-brand-border rounded-xl p-4">
          <p className="text-sm text-gray-300 mb-3">Leads por dia</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily}>
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip contentStyle={{ background: '#141a2b', border: '1px solid #232b40' }} />
              <Bar dataKey="leads" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-brand-card border border-brand-border rounded-xl p-4">
        <p className="text-sm text-gray-300 mb-3">Campanhas</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-gray-400 text-left">
              <tr><th className="py-2">Nome</th><th>Status</th><th>Investimento</th><th>Leads</th><th>CTR</th></tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={String(campaign.id)} className="border-t border-brand-border">
                  <td className="py-2">{campaign.name}</td>
                  <td><span className={`text-xs px-2 py-0.5 rounded ${campaign.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>{campaign.status || '-'}</span></td>
                  <td>{fmt(campaign.spend, true)}</td>
                  <td>{fmt(campaign.leads)}</td>
                  <td>{asNumber(campaign.ctr).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!campaigns.length && <p className="py-5 text-sm text-gray-500">Nenhuma campanha sincronizada para este acesso.</p>}
      </div>
    </div>
  );
}
