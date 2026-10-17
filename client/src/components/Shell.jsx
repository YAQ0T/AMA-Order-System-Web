import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../store/auth';
import { useToast } from './Toast';
import NotificationBell from './NotificationBell';
import ChangePasswordModal from './ChangePasswordModal';
import { T, roleLabel } from '../lib/labels';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  );
}

export default function Shell() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const setTheme = useAuth((s) => s.setTheme);
  const queryClient = useQueryClient();
  const [changingPassword, setChangingPassword] = useState(false);
  const toast = useToast();

  const isDark = Boolean(user?.prefersDark);

  const toggleTheme = async () => {
    try {
      await setTheme(!isDark);
    } catch {
      toast.error(T.somethingWentWrong);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-ink-900/90">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3">
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg object-contain" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold text-slate-900 dark:text-ink-50">
              {T.appName}
            </h1>
            {user && (
              <p className="truncate text-xs text-slate-500 dark:text-ink-400">
                {user.username} — {roleLabel(user.role)}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => queryClient.invalidateQueries()}
            title={T.refresh}
            aria-label={T.refresh}
            className="btn-ghost p-2"
          >
            <RefreshIcon />
          </button>

          <NotificationBell />

          <button
            type="button"
            onClick={toggleTheme}
            title={T.darkMode}
            aria-label={T.darkMode}
            aria-pressed={isDark}
            className="btn-ghost p-2"
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>

          <button
            type="button"
            onClick={() => setChangingPassword(true)}
            title={T.changePassword}
            aria-label={T.changePassword}
            className="btn-ghost p-2"
          >
            <KeyIcon />
          </button>

          <button
            type="button"
            onClick={logout}
            title={T.logout}
            aria-label={T.logout}
            className="btn-ghost p-2"
          >
            <LogoutIcon />
          </button>
        </div>
      </header>

      {user?.mustChangePassword && (
        <div className="border-b border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-2 text-sm text-red-800 dark:text-red-200">
            <span className="flex-1 font-semibold">{T.defaultPasswordWarning}</span>
            <button type="button" className="btn-danger text-xs" onClick={() => setChangingPassword(true)}>
              {T.changeNow}
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1400px] px-4 py-4">
        <Outlet />
      </main>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
