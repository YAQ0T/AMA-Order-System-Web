import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../store/auth';
import { T } from '../lib/labels';

export default function Login() {
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (token && user) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const signedIn = await login(username.trim(), password);
      if (!signedIn.isApproved && signedIn.role !== 'admin') {
        navigate('/pending', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      // The server returns requiresApproval:true with a 403 for unapproved users.
      if (err?.body?.requiresApproval) {
        navigate('/pending', { replace: true });
        return;
      }
      setError(err?.message || T.somethingWentWrong);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src="/logo.png" alt="" className="h-16 w-16 rounded-xl object-contain" />
          <h1 className="text-xl font-bold">{T.appName}</h1>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="username">
              {T.username}
            </label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              {T.password}
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? T.signingIn : T.login}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600 dark:text-ink-400">
          {T.noAccount}{' '}
          <Link to="/signup" className="font-bold text-brand-600 hover:underline dark:text-indigo">
            {T.signup}
          </Link>
        </p>
      </div>
    </div>
  );
}
