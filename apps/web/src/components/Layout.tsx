import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../store';

const baseLinks = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/campanhas', label: 'Campanhas' },
];

export default function Layout() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const canViewClients = ['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER'].includes(user?.role || '');
  const links = canViewClients
    ? [...baseLinks, { to: '/clientes', label: 'Clientes', end: false }]
    : baseLinks;

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
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="w-full md:w-60 bg-brand-card border-b md:border-b-0 md:border-r border-brand-border p-4 flex md:min-h-screen md:flex-col">
        <div className="text-lg font-bold mr-5 md:mr-0 md:mb-6 bg-gradient-to-r from-brand-blue to-brand-purple bg-clip-text text-transparent whitespace-nowrap">
          Gestão Ads
        </div>
        <nav className="flex flex-1 gap-1 overflow-x-auto md:flex-col">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `px-3 py-2 rounded-lg text-sm whitespace-nowrap ${isActive ? 'bg-brand-blue/20 text-brand-blue' : 'text-gray-400 hover:bg-white/5'}`}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden md:block text-xs text-gray-500 mb-2 truncate" title={user?.name}>{user?.name}</div>
        <button onClick={logout} className="ml-2 md:ml-0 text-sm text-red-400 hover:text-red-300 text-left whitespace-nowrap">Sair</button>
      </aside>
      <main className="flex-1 p-4 md:p-6 overflow-auto"><Outlet /></main>
    </div>
  );
}
