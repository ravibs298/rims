import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={loc.state?.from ?? '/'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(email, password); nav(loc.state?.from ?? '/', { replace: true }); }
    catch (err: any) { setError(err.message ?? 'Sign in failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel login">
      <h1>Sign in to RIMS</h1>
      <p className="muted">XYZ Retail Corporation · Inventory Management</p>
      <form className="form" onSubmit={submit}>
        <label><span>Email</span><input name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label><span>Password</span><input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="alert" role="alert">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
