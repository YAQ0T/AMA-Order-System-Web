import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as notificationsApi from '../api/notifications';
import { enablePush, pushSupported } from '../lib/push';
import { useToast } from './Toast';
import { T } from '../lib/labels';
import { formatDateTime } from '../lib/format';

/**
 * Browser push is switched OFF. In real use it proved unreliable on the
 * phones that matter: Samsung puts the browser to sleep to save battery, and
 * iPhone only allows it from a home-screen web app. Takers get new orders on
 * Telegram instead (see TelegramLinkCard). Offering a control that usually
 * fails would only teach people to ignore notifications.
 *
 * The plumbing is kept so this can be revisited, e.g. for desktop users once
 * the site is served over HTTPS.
 */
const OFFER_BROWSER_PUSH = false;

const PUSH_MESSAGES = {
  subscribed: T.pushSubscribed,
  denied: T.pushDenied,
  unsupported: T.pushUnsupported,
  'server-disabled': T.pushServerDisabled,
  failed: T.pushFailed,
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  // Only offer the control when it could actually work and hasn't been answered.
  const canOfferPush = OFFER_BROWSER_PUSH && pushSupported() && Notification.permission === 'default';

  const turnOnPush = async () => {
    const result = await enablePush();
    const message = PUSH_MESSAGES[result] || T.pushFailed;
    if (result === 'subscribed') toast.success(message);
    else toast.error(message);
  };

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsApi.fetchNotifications,
    refetchInterval: 60_000,
  });

  const unread = notifications.filter((n) => !n.isRead);

  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={T.notifications}
        aria-label={T.notifications}
        className="btn-ghost relative p-2"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread.length > 0 && (
          <span className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            <span className="ltr">{unread.length > 99 ? '99+' : unread.length}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 z-50 mt-2 max-h-[70vh] w-80 overflow-y-auto card p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
            <span className="text-sm font-bold">{T.notifications}</span>
            {unread.length > 0 && (
              <button
                type="button"
                className="text-xs font-bold text-brand-600 hover:underline dark:text-indigo"
                onClick={() => markAll.mutate()}
              >
                {T.markAllRead}
              </button>
            )}
          </div>

          {canOfferPush && (
            <button
              type="button"
              onClick={turnOnPush}
              className="block w-full border-b border-slate-200 px-3 py-2 text-start text-xs font-bold text-brand-600 hover:bg-slate-50 dark:border-slate-700 dark:text-indigo dark:hover:bg-slate-700"
            >
              {T.enablePush}
            </button>
          )}

          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-ink-400">
              {T.noNotifications}
            </p>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li
                  key={n.id}
                  onClick={() => !n.isRead && markRead.mutate(n.id)}
                  className={[
                    'cursor-pointer border-b border-slate-100 px-3 py-2 text-sm last:border-0 dark:border-slate-700/60',
                    n.isRead ? 'opacity-60' : 'bg-brand-50/60 dark:bg-indigo/10',
                  ].join(' ')}
                >
                  <p className="font-semibold">{n.message}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-ink-400">
                    <span className="ltr">{formatDateTime(n.createdAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
