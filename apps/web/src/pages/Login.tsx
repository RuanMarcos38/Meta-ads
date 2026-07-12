import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../store';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useAuth((state) => state.setUser);
  const navigate = useNavigate();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data } = await api.post('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });
      localStorage.setItem('token', data.data.token);
      localStorage.setItem('refresh', data.data.refresh);
      setUser(data.data.user);
      navigate('/');
    } catch {
      setError('E-mail ou senha inválidos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-brand-card border border-brand-border rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-center mb-1 bg-gradient-to-r from-brand-blue to-brand-purple bg-clip-text text-transparent">Gestão Ads</h1>
        <p className="text-center text-sm text-gray-400 mb-6">R2R Marketing Digital</p>

        <label className="text-sm text-gray-300" htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full mb-4 mt-1 px-3 py-2 rounded-lg bg-brand-bg border border-brand-border outline-none focus:border-brand-blue"
        />

        <label className="text-sm text-gray-300" htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full mb-4 mt-1 px-3 py-2 rounded-lg bg-brand-bg border border-brand-border outline-none focus:border-brand-blue"
        />

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-brand-blue to-brand-purple font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
