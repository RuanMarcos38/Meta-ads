import { useEffect, useState } from 'react';
import { api } from '../api';
export default function Campaigns() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.get('/dashboard/campaigns').then(r => setRows(r.data.data)); }, []);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Campanhas</h1>
      <div className="bg-brand-card border border-brand-border rounded-xl p-4">
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-left">
            <tr><th className="py-2">Nome</th><th>Objetivo</th><th>Status</th><th>Investimento</th><th>Impressões</th><th>Leads</th><th>Conversas</th><th>CPC</th></tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className="border-t border-brand-border">
                <td className="py-2">{c.name}</td><td>{c.objective}</td><td>{c.status}</td>
                <td>{Number(c.spend).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                <td>{c.impressions?.toLocaleString('pt-BR')}</td><td>{c.leads}</td><td>{c.conversations}</td>
                <td>{Number(c.cpc || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
