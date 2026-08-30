import { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, apiBaseURL } from '../api';
import { useAuth } from '../store';

const BUILD_ID = '2026.08.29.6';

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
      const { data } = await api.post('/auth/login-bm', {
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
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : apiState === 'checking'
      ? 'border-slate-200 bg-slate-50 text-slate-500'
      : 'border-amber-200 bg-amber-50 text-amber-700';

  return (
    <div className="min-h-screen bg-[#f4f6f4] px-4 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center justify-center">
        <form
          onSubmit={submit}
          data-build-id={BUILD_ID}
          className="w-full rounded-[14px] border border-[#dce3dd] bg-white p-7 shadow-[0_16px_38px_rgba(20,48,34,0.09)] sm:p-8"
        >
          <div className="mb-7 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[10px] bg-brand-blue text-white shadow-sm">
              <BarChart3 size={21} strokeWidth={1.9} />
            </span>
            <div>
              <h1 className="text-xl font-extrabold tracking-[-0.02em] text-[#18231d]">Gestão Ads</h1>
              <p className="mt-0.5 text-xs font-medium text-slate-500">R2R Marketing Digital</p>
            </div>
          </div>

          <div className={`mb-5 rounded-[9px] border px-3.5 py-2.5 text-xs font-medium ${statusClass}`}>
            {statusText}
          </div>

          <label className="text-xs font-semibold text-slate-600" htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mb-4 mt-1.5 h-11 w-full rounded-[9px] border border-brand-border bg-white px-3.5 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#91b19f]"
          />

          <label className="text-xs font-semibold text-slate-600" htmlFor="password">Senha</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mb-4 mt-1.5 h-11 w-full rounded-[9px] border border-brand-border bg-white px-3.5 text-sm text-slate-800 outline-none transition-colors focus:border-[#91b19f]"
          />

          {error && <p className="mb-3 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
          <button
            disabled={loading || apiState === 'offline' || apiState === 'database-error'}
            className="h-11 w-full rounded-[9px] bg-brand-blue text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-purple disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
          <p className="mt-5 text-center text-[10px] text-slate-400">
            A Business Manager é configurada dentro da plataforma pelo administrador.
          </p>
          <p className="mt-2 break-all text-center text-[10px] text-slate-300">
            v{BUILD_ID} · {apiBaseURL}
          </p>
        </form>
      </div>
    </div>
  );
}
