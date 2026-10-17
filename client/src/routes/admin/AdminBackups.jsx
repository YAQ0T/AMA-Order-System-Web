import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as adminApi from '../../api/admin';
import { T } from '../../lib/labels';
import { formatDateTime } from '../../lib/format';
import { EmptyState, ErrorState, Ltr, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

const formatSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const KIND = {
  manual: T.backupKindManual,
  'before-restore': T.backupKindSafety,
};

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
      <dt className="text-sm text-slate-500 sm:w-40 dark:text-ink-400">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm font-semibold">{children}</dd>
    </div>
  );
}

/** A file path, kept left-to-right and allowed to wrap anywhere. */
const PathText = ({ children }) => (
  <span dir="ltr" className="inline-block max-w-full break-all font-mono text-xs font-normal">
    {children}
  </span>
);

export default function AdminBackups() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(null);

  const query = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: adminApi.fetchBackups,
    // While a backup is running elsewhere (an automatic one), watch for it to finish.
    refetchInterval: (q) => (q.state.data?.status?.running ? 3000 : false),
  });

  const create = useMutation({
    mutationFn: adminApi.createBackup,
    onSuccess: () => toast.success(T.backupDone),
    onError: (err) => toast.error(err?.message || T.somethingWentWrong),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'backups'] }),
  });

  const download = async (name) => {
    setDownloading(name);
    try {
      await adminApi.downloadBackup(name);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setDownloading(null);
    }
  };

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-8 w-8 text-brand-500" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const { status, backups } = query.data;
  const busy = create.isPending || status.running;

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold">{T.backups}</h2>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => create.mutate()}>
            {busy ? <Spinner className="h-4 w-4" /> : null}
            {busy ? T.backingUp : T.backupNow}
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-600 dark:text-ink-400">{T.backupIntro}</p>

        <dl className="divide-y divide-slate-100 dark:divide-slate-700/60">
          <Row label={T.backupAuto}>
            {status.auto ? (
              <span className="text-emerald-700 dark:text-emerald-400">{T.backupAutoOn}</span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">{T.backupAutoOff}</span>
            )}
          </Row>
          <Row label={T.backupLast}>
            {backups[0] ? (
              <>
                <Ltr>{formatDateTime(backups[0].createdAt)}</Ltr>
                <span className="text-slate-500 dark:text-ink-400">
                  {' — '}
                  <Ltr>{formatSize(backups[0].size)}</Ltr>
                </span>
              </>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">{T.backupNone}</span>
            )}
          </Row>
          {status.lastError && (
            <Row label={T.backupLastError}>
              <span className="text-red-600 dark:text-red-400">
                <Ltr>{formatDateTime(status.lastError.at)}</Ltr> — <PathText>{status.lastError.message}</PathText>
              </span>
            </Row>
          )}
          <Row label={T.backupFolder}>
            <PathText>{status.dir || '—'}</PathText>
          </Row>
          <Row label={T.backupCopyFolder}>
            {status.copyDir ? (
              <PathText>{status.copyDir}</PathText>
            ) : (
              <span className="block rounded-lg bg-amber-50 px-3 py-2 text-xs font-normal text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                {T.backupCopyMissing}
              </span>
            )}
          </Row>
          {status.lastCopyError && (
            <Row label={T.backupCopyFailed}>
              <span className="text-red-600 dark:text-red-400">
                <PathText>{status.lastCopyError.message}</PathText>
              </span>
            </Row>
          )}
        </dl>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold">
          {T.backupList} (<Ltr>{backups.length}</Ltr>)
        </h2>
        {backups.length === 0 ? (
          <EmptyState>{T.backupNone}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-ink-400">
                  <th className="py-2 text-start font-bold">{T.backupDate}</th>
                  <th className="py-2 text-start font-bold">{T.backupKind}</th>
                  <th className="py-2 text-start font-bold">{T.backupSize}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.name} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
                    <td className="py-2">
                      <Ltr>{formatDateTime(b.createdAt)}</Ltr>
                    </td>
                    <td className="py-2">{KIND[b.label] || T.backupKindAuto}</td>
                    <td className="py-2">
                      <Ltr>{formatSize(b.size)}</Ltr>
                    </td>
                    <td className="py-2 text-end">
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={downloading === b.name}
                        onClick={() => download(b.name)}
                      >
                        {downloading === b.name ? <Spinner className="h-3 w-3" /> : null}
                        {T.backupDownload}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-bold">{T.backupRestoreTitle}</h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-ink-400">{T.backupRestoreBody}</p>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-ink-950/50 dark:text-ink-400">
          {T.backupPrivate}
        </p>
      </section>
    </div>
  );
}
