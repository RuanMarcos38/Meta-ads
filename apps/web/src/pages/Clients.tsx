import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../store';

export default function Clients() {
  const user = useAuth((state) => state.user);
  const canView = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const canCreate = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!canView) {
      setLoading(false);
      return;
    }

    setError('');
    try {
      const response = await api.get('/clients');
      setRows(Array.isArray(response.data.data) ? response.data.data : []);
    } catch {
      setError('Não foi possível carregar os clientes deste acesso.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [canView]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || !canCreate) return;

    setSaving(true);
    setError('');
    try {
      await api.post('/clients', { name: normalizedName });
      setName('');
      await load();
    } catch {
      setError('O cliente não foi cadastrado. Verifique os dados e as permissões do usuário.');
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300">Seu perfil não possui acesso ao cadastro de clientes.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">Clientes</h1>
        <button onClick={() => { setLoading(true); void load(); }} className="px-3 py-2 rounded-lg border border-brand-border text-sm text-gray-300 hover:bg-white/5">Atualizar</button>
      </div>

      {canCreate && (
        <form onSubmit={create} className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome do cliente"
            minLength={2}
            required
            className="flex-1 px-3 py-2 rounded-lg bg-brand-card border border-brand-border outline-none focus:border-brand-blue"
          />
          <button disabled={saving} className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-blue to-brand-purple text-sm font-medium disabled:opacity-50">
            {saving ? 'Cadastrando...' : 'Cadastrar'}
          </button>
        </form>
      )}

      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">{error}</p>}

      <div className="bg-brand-card border border-brand-border rounded-xl p-4">
        {loading ? (
          <p className="text-sm text-gray-400">Carregando clientes...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-gray-400 text-left"><tr><th className="py-2">Nome</th><th>Empresa</th><th>Segmento</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((client) => (
                  <tr key={String(client.id)} className="border-t border-brand-border">
                    <td className="py-2">{client.name}</td>
                    <td>{client.companyName || '-'}</td>
                    <td>{client.segment || '-'}</td>
                    <td>{client.status || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !rows.length && !error && <p className="py-5 text-sm text-gray-500">Nenhum cliente encontrado para este acesso.</p>}
      </div>
    </div>
  );
}
