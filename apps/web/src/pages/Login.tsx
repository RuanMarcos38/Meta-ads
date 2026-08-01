import { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { api, apiBaseURL } from '../api';
import { useAuth } from '../store';

const BUILD_ID = '2026.08.01.1';

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

type ApiState = 'checking' | 'online' | 'database-error' | 'offline';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiState, setApiState] = useState<ApiState>('checking');
  const [adminReady, setAdminReady] = useState<boolean | null>(null);
  const setUser = useAuth((state) => state.setUser);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function checkApi() {
      try {
        const [health, status] = await Promise.all([
          api.get('/health'),
          api.get('/auth/status'),
        ]);
        if (!active) return;
        setApiState(health.data?.data?.database === 'connected' ? 'online' : 'database-error');
        setAdminReady(Boolean(status.data?.data?.ready));
      } catch (caughtError) {
        if (!active) return;
        if (axios.isAxiosError(caughtError) && caughtError.response?.status === 503) {
          setApiState('database-error');
        } else {
          setApiState('offline');
        }
      }
    }

    checkApi();
    return () => { active = false; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data } = await api.post('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });

      const token = data?.data?.token;
      const refresh = data?.data?.refresh;
      const user = data?.data?.user;
      if (!token || !refresh || !user) throw new Error('Resposta de login incompleta.');

      localStorage.setItem('token', token);
      localStorage.setItem('refresh', refresh);
      setUser(user);
      navigate('/');
    } catch (caughtError) {
      if (!axios.isAxiosError(caughtError)) {
        setError('Não foi possível concluir o login. Tente novamente.');
        return;
      }

      const status = caughtError.response?.status;
      const payload = caughtError.response?.data as ApiErrorPayload | undefined;
      const apiMessage = payload?.error?.message;

      if (!caughtError.response) {
        setError('Não foi possível conectar à API. O backend está offline ou o domínio da API está incorreto.');
      } else if (status === 401) {
        setError(adminReady === false
          ? 'Nenhum administrador ativo foi encontrado no banco. O acesso inicial precisa ser criado no backend.'
          : 'E-mail ou senha inválidos.');
      } else if (status === 429) {
        setError('Muitas tentativas de acesso. Aguarde um minuto e tente novamente.');
      } else if (status === 503 || payload?.error?.code === 'DATABASE_UNAVAILABLE') {
        setError('A API está online, mas o banco de dados não respondeu.');
      } else {
        setError(apiMessage || 'Falha ao acessar o sistema. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  }

  const statusText = apiState === 'checking'
    ? 'Verificando API...'
    : apiState === 'online'
      ? (adminReady === false ? 'API online — administrador não inicializado' : 'API e banco conectados')
      : apiState === 'database-error'
        ? 'API online — banco indisponível'
        : 'API indisponível';

  const statusClass = apiState === 'online' && adminReady !== false
    ? 'text-green-400'
    : apiState === 'checking'
      ? 'text-gray-500'
      : 'text-amber-400';

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <form
        onSubmit={submit}
        data-build-id={BUILD_ID}
        className="w-full max-w-sm bg-brand-card border border-brand-border rounded-2xl p-8 shadow-2xl"
      >
        <h1 className="text-2xl font-bold text-center mb-1 bg-gradient-to-r from-brand-blue to-brand-purple bg-clip-text text-transparent">Gestão Ads</h1>
        <p className="text-center text-sm text-gray-400 mb-6">R2R Marketing Digital</p>

        <div className={`mb-4 rounded-lg border border-brand-border bg-brand-bg/60 px-3 py-2 text-xs ${statusClass}`}>
          {statusText}
        </div>

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

        {error && <p className="text-red-400 text-sm mb-3" role="alert">{error}</p>}
        <button
          disabled={loading || apiState === 'offline' || apiState === 'database-error'}
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-brand-blue to-brand-purple font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
        <p className="mt-4 text-center text-[10px] text-gray-600 break-all">
          v{BUILD_ID} · {apiBaseURL}
        </p>
      </form>
    </div>
  );
}
