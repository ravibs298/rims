import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from './api';

export interface User { id: number; email: string; full_name: string; role: string; permissions: string[]; location_ids: number[] | null }
interface AuthState { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => void; can: (perm: string) => boolean }

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(logout).finally(() => setLoading(false));
  }, [logout]);

  useEffect(() => {
    window.addEventListener('rims:unauthorized', logout);
    return () => window.removeEventListener('rims:unauthorized', logout);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    setToken(r.token);
    setUser(r.user);
  }, []);

  const value = useMemo<AuthState>(() => ({ user, loading, login, logout, can: (p) => Boolean(user?.permissions.includes(p)) }), [user, loading, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** UI guard only. The backend enforces every permission independently. */
export function ProtectedRoute({ perm, children }: { perm?: string; children: ReactNode }) {
  const { user, loading, can } = useAuth();
  const loc = useLocation();
  if (loading) return <p className="muted pad">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (perm && !can(perm)) return <div className="pad"><h2>Access denied</h2><p className="muted">Your role does not include access to this area.</p></div>;
  return <>{children}</>;
}
