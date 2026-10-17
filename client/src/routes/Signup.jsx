import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../store/auth';
import { T, ROLES } from '../lib/labels';

// Admin is not offered: the server refuses it too (routes/auth.js). The only
// admin is the one created on first start.
const SELECTABLE_ROLES = ['maker', 'taker', 'accounter'];

export default function Signup() {
  const navigate = useNavigate();
  const signup = useAuth((s) => s.signup);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('maker');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signup(username.trim(), password, role);
      navigate('/pending', { replace: true, state: { justSignedUp: true } });
    } catch (err) {
      setError(err?.message || T.somethingWentWrong);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src="/logo.png" alt="" className="h-16 w-16 rounded-xl object-contain" />
          <h1 className="text-xl font-bold">{T.signup}</h1>
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
              autoComplete="new-password"
              required
              minLength={6}
            />
          </div>

          <div>
            <label className="label" htmlFor="role">
              {T.role}
            </label>
            <select
              id="role"
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {SELECTABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r]}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? T.loading : T.signup}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600 dark:text-ink-400">
          {T.haveAccount}{' '}
          <Link to="/login" className="font-bold text-brand-600 hover:underline dark:text-indigo">
            {T.login}
          </Link>
        </p>
      </div>
    </div>
  );
}
