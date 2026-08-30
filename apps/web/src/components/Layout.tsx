import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../store';
import {
  BarChart3,
  Bell,
  HelpCircle,
  LogOut,
  Megaphone,
  MessageSquareText,
  Plus,
  Search,
  ShieldCheck,
  UserCircle,
  Users,
} from 'lucide-react';

const baseLinks = [
  { to: '/', label: 'Dashboard', end: true, icon: BarChart3 },
  { to: '/campanhas', label: 'Campanhas', end: false, icon: Megaphone },
  { to: '/atendimento', label: 'Atendimento', end: false, icon: MessageSquareText },
];

export default function Layout() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const canViewClients = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const links = canViewClients
    ? [...baseLinks.slice(0, 2), { to: '/clientes', label: 'Clientes', end: false, icon: Users }, baseLinks[2]]
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
    <div className="app-viewport min-h-screen bg-[#f2f4f2] text-slate-950 lg:p-3 xl:p-4">
      <div className="mx-auto flex min-h-screen max-w-[1540px] min-w-0 flex-col overflow-hidden border border-[#d9dfdb] bg-white shadow-[0_12px_34px_rgba(25,42,33,0.07)] lg:min-h-[calc(100vh-1.5rem)] lg:flex-row lg:rounded-[14px]">
        <aside className="relative z-30 flex min-w-0 flex-col border-b border-[#dfe4e1] bg-[#fbfcfb] px-3 py-3 sm:px-4 lg:w-[238px] lg:shrink-0 lg:border-b-0 lg:border-r lg:p-4.5">
          <div className="flex min-w-0 items-center justify-between gap-3 lg:block">
            <button type="button" onClick={() => navigate('/')} className="flex min-w-0 items-center gap-3 text-left lg:mb-7" title="Ir para o dashboard">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-[#176846] text-white">
                <BarChart3 size={19} strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-[14px] font-semibold tracking-[-0.01em] text-[#18231d]">Gestão Ads</strong>
                <small className="mt-0.5 block truncate text-[10px] font-medium tracking-wide text-slate-500">R2R Marketing</small>
              </span>
            </button>

            <button type="button" onClick={logout} className="grid h-10 w-10 shrink-0 place-items-center rounded-[7px] border border-[#e2e6e3] bg-white text-red-600 transition-colors hover:bg-red-50 lg:hidden" title="Sair">
              <LogOut size={16} />
              <span className="sr-only">Sair</span>
            </button>
          </div>

          <div className="premium-scrollbar mt-3 min-w-0 flex-1 overflow-x-auto pb-1 lg:mt-0 lg:overflow-visible lg:pb-0">
            <p className="mb-2 hidden px-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:block">Operação</p>
            <nav className="flex min-w-max snap-x gap-2 lg:min-w-0 lg:flex-col">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => [
                    'flex min-h-10 min-w-fit snap-start items-center gap-2.5 rounded-[7px] px-3 py-2.5 text-[12px] font-semibold transition-colors duration-150 lg:gap-3',
                    isActive ? 'bg-[#176846] text-white' : 'border border-transparent text-slate-600 hover:bg-[#edf2ee] hover:text-slate-950',
                  ].join(' ')}>
                    <Icon size={15} strokeWidth={1.9} />
                    {link.label}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div className="hidden lg:block">
            <div className="rounded-[9px] border border-[#dce4df] bg-[#f3f6f3] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-[#26352d]"><ShieldCheck size={14} strokeWidth={1.9} /> Ambiente de produção</div>
              <p className="mt-1.5 text-[10px] leading-4 text-slate-500">API, banco e auditoria operando em ambiente isolado.</p>
            </div>
            <button type="button" onClick={() => navigate('/atendimento')} className="mt-3 flex w-full items-center gap-3 rounded-[7px] px-3 py-2.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-[#edf2ee] hover:text-slate-900" title="Central de atendimento">
              <HelpCircle size={15} /> Ajuda e chamados
            </button>
            <button type="button" onClick={logout} className="mt-1 flex w-full items-center gap-3 rounded-[7px] px-3 py-2.5 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50">
              <LogOut size={15} /> Sair
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-visible bg-white lg:overflow-hidden">
          <header className="flex min-w-0 flex-col gap-3 border-b border-[#dfe4e1] bg-white px-3 py-3 sm:px-4 md:flex-row md:items-center md:justify-between md:px-6">
            <label className="relative block min-w-0 flex-1 md:max-w-xl">
              <span className="sr-only">Buscar campanha, cliente ou conta</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input className="h-10 w-full rounded-[7px] border border-[#dfe5e1] bg-[#f8faf8] pl-9 pr-4 text-[12px] text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#9ab9a8] focus:bg-white" placeholder="Buscar campanha, cliente ou conta" onKeyDown={(event) => { if (event.key === 'Enter') navigate('/campanhas'); }} />
            </label>

            <div className="flex min-w-0 items-center justify-between gap-2 md:shrink-0 md:justify-end">
              <button type="button" onClick={() => navigate('/campanhas')} className="inline-flex h-10 min-w-10 items-center justify-center gap-2 whitespace-nowrap rounded-[7px] bg-[#176846] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#12563a] sm:px-3.5" title="Nova campanha"><Plus size={15} /><span className="hidden sm:inline">Nova campanha</span></button>
              <button type="button" onClick={() => navigate('/atendimento')} className="grid h-10 w-10 shrink-0 place-items-center rounded-[7px] border border-[#dfe4e1] bg-white text-slate-600 transition-colors hover:bg-[#f5f7f5]" title="Atendimento interno"><MessageSquareText size={15} /></button>
              <button type="button" onClick={() => navigate('/')} className="grid h-10 w-10 shrink-0 place-items-center rounded-[7px] border border-[#dfe4e1] bg-white text-slate-600 transition-colors hover:bg-[#f5f7f5]" title="Notificações"><Bell size={15} /></button>
              <div className="ml-0 flex min-w-0 items-center gap-2 border-l border-[#dfe4e1] pl-2 sm:ml-1 sm:gap-2.5 sm:pl-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#e8ece8] text-[12px] font-semibold text-[#163f31]">{userInitial}</span>
                <span className="hidden min-w-0 sm:block sm:max-w-[160px] lg:max-w-[190px]"><strong className="block truncate text-[11px] font-semibold text-[#1b2720]">{user?.name || 'Usuário'}</strong><small className="mt-0.5 block truncate text-[9px] text-slate-500">{user?.email || user?.role}</small></span>
                <UserCircle className="hidden shrink-0 text-slate-300 xl:block" size={17} />
              </div>
            </div>
          </header>
          <section className="premium-scrollbar min-w-0 overflow-visible px-3 py-3 sm:px-4 sm:py-4 md:px-6 md:py-5 lg:max-h-[calc(100vh-68px)] lg:overflow-auto">
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  );
}
