import { create } from 'zustand';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  mustChangePassword?: boolean;
}

interface State {
  user: User | null;
  setUser: (user: User | null) => void;
}

function readStoredUser(): User | null {
  try {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) as User : null;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
}

export const useAuth = create<State>((set) => ({
  user: readStoredUser(),
  setUser: (user) => {
    if (user) localStorage.setItem('user', JSON.stringify(user));
    else localStorage.removeItem('user');
    set({ user });
  },
}));
