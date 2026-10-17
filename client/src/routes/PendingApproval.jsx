import { useNavigate } from 'react-router-dom';

import { useAuth } from '../store/auth';
import { T } from '../lib/labels';

export default function PendingApproval() {
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);

  const backToLogin = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>

        <h1 className="mb-2 text-lg font-bold">{T.pendingTitle}</h1>
        <p className="mb-6 text-sm leading-relaxed text-slate-600 dark:text-ink-400">
          {T.pendingBody}
        </p>

        <button type="button" onClick={backToLogin} className="btn-secondary w-full">
          {T.login}
        </button>
      </div>
    </div>
  );
}
