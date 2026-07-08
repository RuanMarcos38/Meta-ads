import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../store';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/campanhas', label: 'Campanhas' },
  { to: '/clientes', label: 'Clientes' },
];

export default function Layout() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  function logout() { localStorage.clear(); setUser(null); nav('/login'); }
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 bg-brand-card border-r border-brand-border p-4 flex flex-col">
        <div className="text-lg font-bold mb-6 bg-gradient-to-r from-brand-blue to-brand-purple bg-clip-text text-transparent">Gestão Ads</div>
        <nav className="flex flex-col gap-1 flex-1">
          {links.map(l => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => `px-3 py-2 rounded-lg text-sm ${isActive ? 'bg-brand-blue/20 text-brand-blue' : 'text-gray-400 hover:bg-white/5'}`}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="text-xs text-gray-500 mb-2">{user?.name}</div>
        <button onClick={logout} className="text-sm text-red-400 hover:text-red-300 text-left">Sair</button>
      </aside>
      <main className="flex-1 p-6 overflow-auto"><Outlet /></main>
    </div>
  );
}
