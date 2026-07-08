import { useEffect, useState } from 'react';
import { api } from '../api';
export default function Clients() {
  const [rows, setRows] = useState<any[]>([]);
  const [name, setName] = useState('');
  async function load() { const r = await api.get('/clients'); setRows(r.data.data); }
  useEffect(() => { load(); }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!name) return;
    await api.post('/clients', { name }); setName(''); load();
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Clientes</h1>
      <form onSubmit={create} className="flex gap-2 mb-4">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome do cliente"
          className="px-3 py-2 rounded-lg bg-brand-card border border-brand-border outline-none focus:border-brand-blue" />
        <button className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-blue to-brand-purple text-sm font-medium">Cadastrar</button>
      </form>
      <div className="bg-brand-card border border-brand-border rounded-xl p-4">
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-left"><tr><th className="py-2">Nome</th><th>Empresa</th><th>Segmento</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className="border-t border-brand-border">
                <td className="py-2">{c.name}</td><td>{c.companyName || '-'}</td><td>{c.segment || '-'}</td><td>{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
