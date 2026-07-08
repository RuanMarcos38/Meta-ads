import { useEffect, useState } from 'react';
import { api } from '../api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

const fmt = (n: number, currency = false) =>
  currency ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : n.toLocaleString('pt-BR');

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-brand-card border border-brand-border rounded-xl p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState<any>(null);
  const [daily, setDaily] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    const [s, d, c] = await Promise.all([
      api.get('/dashboard/summary'), api.get('/dashboard/daily'), api.get('/dashboard/campaigns'),
    ]);
    setSummary(s.data.data); setDaily(d.data.data); setCampaigns(c.data.data);
  }
  useEffect(() => { load(); }, []);

  async function sync() {
    setSyncing(true);
    try { await api.post('/dashboard/sync', {}); await load(); }
    catch { alert('Erro ao sincronizar. Tente novamente.'); }
    finally { setSyncing(false); }
  }

  if (!summary) return <p className="text-gray-400">Carregando...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold">Dashboard Executivo</h1>
        <button onClick={sync} disabled={syncing}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-blue to-brand-purple font-medium text-sm disabled:opacity-50">
          {syncing ? 'Atualizando...' : 'Atualizar Dados'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card label="Investimento" value={fmt(summary.spend, true)} />
        <Card label="Leads" value={fmt(summary.leads)} />
        <Card label="Conversas" value={fmt(summary.conversations)} />
        <Card label="Custo/Lead" value={fmt(summary.costPerLead, true)} />
        <Card label="Impressões" value={fmt(summary.impressions)} />
        <Card label="Alcance" value={fmt(summary.reach)} />
        <Card label="CTR" value={`${summary.ctr.toFixed(2)}%`} />
        <Card label="CPC" value={fmt(summary.cpc, true)} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
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
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-left">
            <tr><th className="py-2">Nome</th><th>Status</th><th>Investimento</th><th>Leads</th><th>CTR</th></tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t border-brand-border">
                <td className="py-2">{c.name}</td>
                <td><span className={`text-xs px-2 py-0.5 rounded ${c.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>{c.status}</span></td>
                <td>{fmt(c.spend, true)}</td>
                <td>{c.leads}</td>
                <td>{c.ctr?.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
