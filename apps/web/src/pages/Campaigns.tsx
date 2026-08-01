import { useEffect, useState } from 'react';
import { api } from '../api';

const money = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const number = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR');

export default function Campaigns() {
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const response = await api.get('/dashboard/campaigns');
      setRows(Array.isArray(response.data.data) ? response.data.data : []);
    } catch {
      setError('Não foi possível carregar as campanhas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">Campanhas</h1>
        <button onClick={() => { setLoading(true); void load(); }} className="px-3 py-2 rounded-lg border border-brand-border text-sm text-gray-300 hover:bg-white/5">Atualizar</button>
      </div>

      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">{error}</p>}

      <div className="bg-brand-card border border-brand-border rounded-xl p-4">
        {loading ? (
          <p className="text-sm text-gray-400">Carregando campanhas...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="text-gray-400 text-left">
                <tr><th className="py-2">Nome</th><th>Objetivo</th><th>Status</th><th>Investimento</th><th>Impressões</th><th>Leads</th><th>Conversas</th><th>CPC</th></tr>
              </thead>
              <tbody>
                {rows.map((campaign) => (
                  <tr key={String(campaign.id)} className="border-t border-brand-border">
                    <td className="py-2">{campaign.name}</td>
                    <td>{campaign.objective || '-'}</td>
                    <td>{campaign.status || '-'}</td>
                    <td>{money(campaign.spend)}</td>
                    <td>{number(campaign.impressions)}</td>
                    <td>{number(campaign.leads)}</td>
                    <td>{number(campaign.conversations)}</td>
                    <td>{money(campaign.cpc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !rows.length && !error && <p className="py-5 text-sm text-gray-500">Nenhuma campanha sincronizada.</p>}
      </div>
    </div>
  );
}
