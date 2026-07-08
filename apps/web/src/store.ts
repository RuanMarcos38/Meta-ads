import { create } from 'zustand';
interface User { id: string; name: string; email: string; role: string; }
interface State { user: User | null; setUser: (u: User | null) => void; }
export const useAuth = create<State>((set) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  setUser: (u) => { localStorage.setItem('user', JSON.stringify(u)); set({ user: u }); },
}));
