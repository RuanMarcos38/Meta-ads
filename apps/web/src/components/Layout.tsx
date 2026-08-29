import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../store';
import {
  BarChart3,
  Bell,
  HelpCircle,
  LogOut,
  Mail,
  Megaphone,
  Plus,
  Search,
  Settings,
  UserCircle,
  Users,
} from 'lucide-react';

const baseLinks = [
  { to: '/', label: 'Dashboard', end: true, icon: BarChart3 },
  { to: '/campanhas', label: 'Campanhas', end: false, icon: Megaphone },
];

export default function Layout() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const canViewClients = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const links = canViewClients
    ? [...baseLinks, { to: '/clientes', label: 'Clientes', end: false, icon: Users }]
    : baseLinks;
  const userInitial = (user?.name || user?.email || 'U').trim().charAt(0).toUpperCase();

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // A sessão local deve ser encerrada mesmo se a API estiver indisponível.
    }

    localStorage.removeItem('token');
    localStorage.removeItem('refresh');
    setUser(null);
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-brand-bg text-slate-950 lg:p-5">
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col overflow-hidden bg-white/60 shadow-soft lg:min-h-[calc(100vh-2.5rem)] lg:flex-row lg:rounded-[28px] lg:border lg:border-white">
        <aside className="flex border-b border-brand-border bg-white/80 p-4 lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mr-4 flex min-w-fit items-center gap-3 text-left lg:mb-10 lg:mr-0"
            title="Ir para o dashboard"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-blue text-white">
              <BarChart3 size={22} />
            </span>
            <span>
              <strong className="block text-base font-extrabold tracking-tight text-slate-950">Gestão Ads</strong>
              <small className="block text-xs font-medium text-slate-500">R2R Marketing</small>
            </span>
          </button>

          <div className="min-w-0 flex-1 overflow-x-auto lg:overflow-visible">
            <p className="mb-2 hidden px-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 lg:block">Operação</p>
            <nav className="flex gap-2 lg:flex-col">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) => [
                      'flex min-w-fit items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                      isActive
                        ? 'bg-brand-blue text-white shadow-sm'
                        : 'text-slate-500 hover:bg-[#edf3ea] hover:text-slate-900',
                    ].join(' ')}
                  >
                    <Icon size={18} />
                    {link.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="hidden lg:block">
            <div className="rounded-2xl bg-[#f1f6ef] p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Settings size={16} />
                Produção
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">Dados conectados e auditoria server-side.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-[#edf3ea] hover:text-slate-900"
              title="Central de ajuda"
            >
              <HelpCircle size={18} />
              Ajuda
            </button>
            <button
              type="button"
              onClick={logout}
              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
            >
              <LogOut size={18} />
              Sair
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex flex-col gap-3 border-b border-brand-border bg-white/80 px-4 py-4 md:px-7 xl:flex-row xl:items-center xl:justify-between">
            <label className="relative block w-full max-w-xl">
              <span className="sr-only">Buscar tarefa operacional</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                className="h-12 w-full rounded-2xl border border-transparent bg-[#f4f7f2] pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-blue focus:bg-white"
                placeholder="Buscar campanha, cliente ou conta"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') navigate('/campanhas');
                }}
              />
            </label>

            <div className="flex items-center justify-between gap-3 xl:justify-end">
              <button
                type="button"
                onClick={() => navigate('/campanhas')}
                className="inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-2xl bg-brand-blue px-5 text-sm font-bold text-white transition hover:bg-brand-purple"
              >
                <Plus size={18} />
                Nova campanha
              </button>
              <button
                type="button"
                onClick={() => navigate('/clientes')}
                className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-brand-border transition hover:bg-[#f4f7f2]"
                title="Clientes"
              >
                <Mail size={18} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-brand-border transition hover:bg-[#f4f7f2]"
                title="Notificações"
              >
                <Bell size={18} />
              </button>
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[#e6c8c1] text-sm font-extrabold text-brand-purple">
                  {userInitial}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <strong className="block truncate text-sm font-bold text-slate-950">{user?.name || 'Usuário'}</strong>
                  <small className="block truncate text-xs text-slate-500">{user?.email || user?.role}</small>
                </span>
                <UserCircle className="hidden text-slate-300 md:block" size={20} />
              </div>
            </div>
          </header>
          <section className="premium-scrollbar max-h-[calc(100vh-88px)] overflow-auto px-4 py-5 md:px-7">
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  );
}
