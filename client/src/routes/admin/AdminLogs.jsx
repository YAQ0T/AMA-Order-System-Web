import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import * as adminApi from '../../api/admin';
import { T } from '../../lib/labels';
import { EmptyState, ErrorState, Spinner } from '../../components/ui';
import ActivityItem from './ActivityItem';

const STEP = 50;

export default function AdminLogs() {
  const [limit, setLimit] = useState(STEP);
  const [all, setAll] = useState(false);

  const query = useQuery({
    queryKey: ['admin', 'logs', { limit, all }],
    queryFn: () => adminApi.fetchActivityLogs({ limit, all }),
    placeholderData: (previous) => previous,
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-8 w-8 text-brand-500" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const logs = query.data ?? [];

  return (
    <section className="card p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold">{T.activityLogs}</h2>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs font-bold">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-500"
            checked={all}
            onChange={(e) => {
              setAll(e.target.checked);
              setLimit(STEP);
            }}
          />
          {/* /logs/all returns every action type; /logs is the filtered feed. */}
          {T.logs}
        </label>
      </header>

      {logs.length === 0 ? (
        <EmptyState>—</EmptyState>
      ) : (
        <>
          <ul>
            {logs.map((log) => (
              <ActivityItem key={`${log.id}-${log.action}`} log={log} />
            ))}
          </ul>

          {logs.length >= limit && (
            <button
              type="button"
              className="btn-secondary mt-3 w-full"
              disabled={query.isFetching}
              onClick={() => setLimit((l) => l + STEP)}
            >
              {query.isFetching ? <Spinner className="h-4 w-4" /> : null}
              {T.loadMore}
            </button>
          )}
        </>
      )}
    </section>
  );
}
