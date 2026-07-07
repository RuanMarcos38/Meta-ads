import { useEffect, useMemo, useState } from 'react';
import { BarChart3, LogOut, RefreshCcw, ShieldCheck, Users, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, clearToken, getToken, setToken } from './api';
import type { Client, Summary, User } from './types';

function brl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function number(value: number) {
  return value.toLocaleString('pt-BR');
}

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<string>('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!getToken()) return;
    setLoading(true);
    setError('');
    try {
      const me = await api<{ user: User }>('/me');
      setUser(me.user);
      const clientsResult = await api<{ clients: Client[] }>('/clients');
      setClients(clientsResult.clients);
      const selected = clientId || clientsResult.clients[0]?.id || '';
      setClientId(selected);
      const query = selected ? `?clientId=${selected}` : '';
      const dashboard = await api<Summary>(`/dashboard/summary${query}`);
      setSummary(dashboard);
    } catch (e: any) {
      setError(e.message);
      if (String(e.message).includes('Token')) logout();
    } finally {
      setLoading(false);
    }
  }

  async function sync() {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      await api('/dashboard/sync', { method: 'POST', body: JSON.stringify({ clientId }) });
      const dashboard = await api<Summary>(`/dashboard/summary?clientId=${clientId}`);
      setSummary(dashboard);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearToken();
    setTokenState(null);
    setUser(null);
    setSummary(null);
  }

  useEffect(() => { load(); }, [token]);
  useEffect(() => {
    if (!clientId || !token) return;
    api<Summary>(`/dashboard/summary?clientId=${clientId}`).then(setSummary).catch((e) => setError(e.message));
  }, [clientId]);

  const chartData = useMemo(() => summary?.campaigns.slice(0, 8).map(c => ({ name: c.campaignName.slice(0, 18), investimento: Number(c.spend.toFixed(2)), cliques: c.clicks })) || [], [summary]);

  if (!token) return <Login onLogin={(newToken) => { setToken(newToken); setTokenState(newToken); }} />;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span><BarChart3 /></span><div><strong>Ads SaaS</strong><small>Cliente em tempo real</small></div></div>
        <nav>
          <a className="active"><Zap size={18}/> Dashboard</a>
          <a><Users size={18}/> Clientes</a>
          <a><ShieldCheck size={18}/> Integrações</a>
        </nav>
      </aside>
      <section className="content">
        <header className="topbar">
          <div>
            <p>Bem-vindo, {user?.name}</p>
            <h1>Painel de campanhas</h1>
          </div>
          <div className="actions">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={user?.role === 'CLIENT'}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={sync} disabled={loading}><RefreshCcw size={17}/> Atualizar</button>
            <button className="ghost" onClick={logout}><LogOut size={17}/></button>
          </div>
        </header>
        {error && <div className="alert">{error}</div>}
        <section className="cards">
          <Kpi title="Investimento" value={brl(summary?.totals.spend || 0)} />
          <Kpi title="Impressões" value={number(summary?.totals.impressions || 0)} />
          <Kpi title="Cliques" value={number(summary?.totals.clicks || 0)} />
          <Kpi title="CTR" value={`${(summary?.totals.ctr || 0).toFixed(2)}%`} />
          <Kpi title="CPC" value={brl(summary?.totals.cpc || 0)} />
          <Kpi title="Conversões" value={number(summary?.totals.conversions || 0)} />
        </section>
        <section className="grid">
          <div className="panel large">
            <div className="panel-title"><h2>Investimento por campanha</h2><span>{loading ? 'Atualizando...' : 'Últimos 7 dias'}</span></div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2}/>
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value: any) => brl(Number(value))}/>
                <Bar dataKey="investimento" radius={[8,8,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel">
            <div className="panel-title"><h2>Status</h2></div>
            <p className="status">Sistema preparado para Meta Ads e Google Ads com isolamento por cliente.</p>
            <p className="muted">Use o modo demo para validar visualmente. Ao configurar tokens reais, desative `DEMO_MODE`.</p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-title"><h2>Campanhas</h2><span>{summary?.campaigns.length || 0} campanhas</span></div>
          <div className="table-wrap"><table><thead><tr><th>Plataforma</th><th>Campanha</th><th>Cliente</th><th>Investimento</th><th>Cliques</th><th>Impressões</th><th>Conversões</th></tr></thead><tbody>{summary?.campaigns.map(c => <tr key={`${c.provider}-${c.campaignExternalId}`}><td><span className={`badge ${c.provider.toLowerCase()}`}>{c.provider}</span></td><td>{c.campaignName}</td><td>{c.clientName}</td><td>{brl(c.spend)}</td><td>{number(c.clicks)}</td><td>{number(c.impressions)}</td><td>{number(c.conversions)}</td></tr>)}</tbody></table></div>
        </section>
      </section>
    </main>
  );
}

function Kpi({ title, value }: { title: string; value: string }) {
  return <div className="kpi"><span>{title}</span><strong>{value}</strong></div>;
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('admin@r2rmarketingdigital.com.br');
  const [password, setPassword] = useState('TroqueEssaSenha123');
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const result = await api<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      onLogin(result.token);
    } catch (e: any) { setError(e.message); }
  }
  return <main className="login"><form onSubmit={submit} className="login-card"><div className="logo"><BarChart3 /></div><h1>Ads Dashboard</h1><p>Painel privado para clientes acompanharem campanhas Meta Ads e Google Ads.</p>{error && <div className="alert">{error}</div>}<label>E-mail<input value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><button>Entrar no painel</button></form></main>;
}
