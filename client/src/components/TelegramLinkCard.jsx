import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchTelegramStatus, createTelegramLink, unlinkTelegram } from '../api/telegram';
import { useToast } from './Toast';
import { Spinner } from './ui';
import { T } from '../lib/labels';
import { useAuth } from '../store/auth';

// Wording and tone per role. For takers Telegram is the only thing that
// reaches their phone, so the prompt is amber and says so. For accountants it
// is a convenience on top of the in-app bell, so it stays calm and blue.
const COPY = {
  taker: {
    title: T.telegramPromptTitle,
    body: T.telegramPromptBody,
    linked: T.telegramLinked,
    tone: 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10',
  },
  accounter: {
    title: T.telegramPromptTitleAccounter,
    body: T.telegramPromptBodyAccounter,
    linked: T.telegramLinkedAccounter,
    tone: 'border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10',
  },
};

const STATUS_KEY = ['telegram', 'status'];

function TelegramIcon({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#2AABEE" />
      <path
        fill="#fff"
        d="M5.4 11.8 16.9 7.4c.5-.2 1 .1.8.9l-2 9.3c-.1.6-.5.8-1 .5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5.1c.2-.2 0-.3-.4-.1l-6.9 4.3-3-.9c-.6-.2-.7-.6.2-.9Z"
      />
    </svg>
  );
}

/**
 * Lets a taker link their Telegram account so new orders reach their phone.
 * Telegram is the ONLY channel that does - the system sends no email - so an
 * unlinked taker only learns of new orders by opening the app. The prompt is
 * amber rather than informational blue for that reason. Hidden entirely when
 * the server has no bot configured.
 *
 * Linking is two taps by design: "link" fetches a one-time code, then
 * "open Telegram" is a real link the user taps. Opening Telegram straight from
 * the first tap would happen after a network round-trip, and phones block
 * app-opening that is not tied directly to a tap.
 */
export default function TelegramLinkCard() {
  const toast = useToast();
  const role = useAuth((st) => st.user?.role);
  const copy = COPY[role] || COPY.taker;
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(null); // { appUrl, url, expiresAt }
  const pendingRef = useRef(null);

  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () => {
      const status = await fetchTelegramStatus();
      // The link completes inside Telegram, so we only learn about it by
      // polling. Announce it once, from here rather than from an effect.
      if (pendingRef.current && status.linked) {
        pendingRef.current = null;
        setPending(null);
        toast.success(T.telegramLinkedToast);
      }
      return status;
    },
    // Poll while waiting for the user to tap Start; returning to the tab also
    // refetches immediately (refetchOnWindowFocus).
    refetchInterval: pending ? 2500 : false,
    retry: false,
  });

  // A link code is only valid for a limited time; drop back to the prompt
  // when it runs out.
  useEffect(() => {
    if (!pending) return undefined;
    const msLeft = new Date(pending.expiresAt).getTime() - Date.now();
    const timer = setTimeout(() => {
      pendingRef.current = null;
      setPending(null);
      toast.error(T.telegramExpired);
    }, Math.max(msLeft, 0));
    return () => clearTimeout(timer);
  }, [pending, toast]);

  const startLink = useMutation({
    mutationFn: createTelegramLink,
    onSuccess: (data) => {
      pendingRef.current = data;
      setPending(data);
    },
    onError: (err) => toast.error(err?.message || T.somethingWentWrong),
  });

  const unlink = useMutation({
    mutationFn: unlinkTelegram,
    onSuccess: () => {
      toast.info(T.telegramUnlinkedToast);
      queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (err) => toast.error(err?.message || T.somethingWentWrong),
  });

  const cancel = () => {
    pendingRef.current = null;
    setPending(null);
  };

  const status = statusQuery.data;
  // Hidden when the server has no bot, or for roles that are never messaged.
  if (!status?.enabled || !status.canLink) return null;

  if (status.linked) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
        <TelegramIcon className="h-5 w-5" />
        <span className="font-bold">✓ {copy.linked}</span>
        {status.telegramUsername && (
          <span dir="ltr" className="text-xs opacity-75">
            @{status.telegramUsername}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="text-xs font-bold underline-offset-2 hover:underline disabled:opacity-50"
          onClick={() => unlink.mutate()}
          disabled={unlink.isPending}
        >
          {T.telegramUnlink}
        </button>
      </div>
    );
  }

  if (pending) {
    return (
      <section className="card mb-4 border-sky-200 bg-sky-50/70 p-4 dark:border-sky-500/30 dark:bg-sky-500/10">
        <div className="mb-3 flex items-center gap-2">
          <TelegramIcon />
          <h3 className="text-sm font-bold">{copy.title}</h3>
        </div>

        <ol className="mb-3 flex flex-col gap-3 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">1</span>
            <span>{T.telegramStep1}</span>
            <a href={pending.appUrl} className="btn-primary px-3 py-1.5 text-xs">
              {T.telegramOpen}
            </a>
            <a
              href={pending.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-700 underline dark:text-sky-300"
            >
              {T.telegramFallback}
            </a>
          </li>
          <li className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">2</span>
            <span>{T.telegramStep2}</span>
          </li>
        </ol>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-ink-400">
          <Spinner className="h-3.5 w-3.5 text-sky-600" />
          <span>{T.telegramWaiting}</span>
          <span className="flex-1" />
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={cancel}>
            {T.cancel}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-ink-400">{T.telegramNeedApp}</p>
      </section>
    );
  }

  return (
    <section className={`card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${copy.tone}`}>
      <TelegramIcon className="h-8 w-8 shrink-0" />
      <div className="flex-1">
        <h3 className="text-sm font-bold">{copy.title}</h3>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-ink-400">{copy.body}</p>
      </div>
      <button
        type="button"
        className="btn-primary"
        onClick={() => startLink.mutate()}
        disabled={startLink.isPending}
      >
        {startLink.isPending ? <Spinner className="h-4 w-4" /> : null}
        {T.telegramLink}
      </button>
    </section>
  );
}
