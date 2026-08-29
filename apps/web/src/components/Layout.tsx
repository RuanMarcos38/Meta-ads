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
  ShieldCheck,
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
    <div className="min-h-screen bg-brand-bg text-slate-950 lg:p-4 xl:p-5">
      <div className="mx-auto flex min-h-screen max-w-[1480px] flex-col overflow-hidden border border-brand-border bg-white shadow-soft lg:min-h-[calc(100vh-2rem)] lg:flex-row lg:rounded-[20px]">
        <aside className="flex border-b border-brand-border bg-[#fbfcfb] p-4 lg:w-[248px] lg:flex-col lg:border-b-0 lg:border-r lg:p-5">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mr-4 flex min-w-fit items-center gap-3 text-left lg:mb-9 lg:mr-0"
            title="Ir para o dashboard"
          >
            <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-brand-blue text-white shadow-sm">
              <BarChart3 size={21} strokeWidth={1.9} />
            </span>
            <span>
              <strong className="block text-[15px] font-extrabold tracking-[-0.015em] text-[#18231d]">Gestão Ads</strong>
              <small className="mt-0.5 block text-[11px] font-medium tracking-wide text-slate-500">R2R Marketing</small>
            </span>
          </button>

          <div className="min-w-0 flex-1 overflow-x-auto lg:overflow-visible">
            <p className="mb-2 hidden px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 lg:block">Operação</p>
            <nav className="flex gap-2 lg:flex-col">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) => [
                      'flex min-w-fit items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold transition-colors duration-150',
                      isActive
                        ? 'bg-brand-blue text-white shadow-sm'
                        : 'text-slate-600 hover:bg-[#edf2ee] hover:text-slate-950',
                    ].join(' ')}
                  >
                    <Icon size={17} strokeWidth={1.9} />
                    {link.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="hidden lg:block">
            <div className="rounded-[12px] border border-[#dce6df] bg-[#f3f6f3] p-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#26352d]">
                <ShieldCheck size={16} strokeWidth={1.9} />
                Ambiente de produção
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">API, banco e auditoria operando em ambiente isolado.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-4 flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold text-slate-500 transition-colors hover:bg-[#edf2ee] hover:text-slate-900"
              title="Central de ajuda"
            >
              <HelpCircle size={17} />
              Ajuda
            </button>
            <button
              type="button"
              onClick={logout}
              className="mt-1 flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
            >
              <LogOut size={17} />
              Sair
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-white">
          <header className="flex min-h-[76px] flex-col gap-3 border-b border-brand-border bg-white px-4 py-3.5 md:px-7 xl:flex-row xl:items-center xl:justify-between">
            <label className="relative block w-full max-w-xl">
              <span className="sr-only">Buscar tarefa operacional</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              <input
                className="h-11 w-full rounded-[10px] border border-[#e1e7e2] bg-[#f7f9f7] pl-10 pr-4 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#9ab9a8] focus:bg-white"
                placeholder="Buscar campanha, cliente ou conta"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') navigate('/campanhas');
                }}
              />
            </label>

            <div className="flex items-center justify-between gap-2.5 xl:justify-end">
              <button
                type="button"
                onClick={() => navigate('/campanhas')}
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[10px] bg-brand-blue px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-purple"
              >
                <Plus size={17} />
                Nova campanha
              </button>
              <button
                type="button"
                onClick={() => navigate('/clientes')}
                className="grid h-11 w-11 place-items-center rounded-[10px] border border-brand-border bg-white text-slate-600 transition-colors hover:bg-[#f5f7f5] hover:text-slate-900"
                title="Clientes"
              >
                <Mail size={17} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="grid h-11 w-11 place-items-center rounded-[10px] border border-brand-border bg-white text-slate-600 transition-colors hover:bg-[#f5f7f5] hover:text-slate-900"
                title="Notificações"
              >
                <Bell size={17} />
              </button>
              <div className="ml-1 flex min-w-0 items-center gap-3 border-l border-brand-border pl-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e8ece8] text-sm font-extrabold text-brand-purple">
                  {userInitial}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <strong className="block truncate text-sm font-bold text-[#1b2720]">{user?.name || 'Usuário'}</strong>
                  <small className="mt-0.5 block truncate text-[11px] text-slate-500">{user?.email || user?.role}</small>
                </span>
                <UserCircle className="hidden text-slate-300 md:block" size={19} />
              </div>
            </div>
          </header>
          <section className="premium-scrollbar max-h-[calc(100vh-76px)] overflow-auto px-4 py-5 md:px-7 md:py-6">
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  );
}
