

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, post } from '../lib/api';
import type { AuthResponse, User } from '../lib/types';

interface AuthValue {
  user: User | null;

  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);


  useEffect(() => {
    let cancelled = false;
    get<AuthResponse>('/auth/me')
      .then((r) => { if (!cancelled) setUser(r.user); })
      .catch((e: unknown) => {
        if (!(e instanceof ApiError && e.isUnauthenticated)) console.error(e);
      })
      .finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<AuthValue>(() => ({
    user,
    restoring,
    login: async (email, password) => {
      setUser((await post<AuthResponse>('/auth/login', { email, password })).user);
    },
    register: async (email, password) => {
      setUser((await post<AuthResponse>('/auth/register', { email, password })).user);
    },
    logout: async () => {
      await post('/auth/logout');
      setUser(null);
    },
  }), [user, restoring]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
