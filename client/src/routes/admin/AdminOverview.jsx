import { useQuery } from '@tanstack/react-query';

import * as adminApi from '../../api/admin';
import { T, roleLabel } from '../../lib/labels';
import { EmptyState, ErrorState, Ltr, Spinner } from '../../components/ui';
import ActivityItem from './ActivityItem';

function StatCard({ label, value, tone }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500 dark:text-ink-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tone || ''}`}>
        <Ltr>{value}</Ltr>
      </p>
    </div>
  );
}

export default function AdminOverview() {
  const query = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.fetchStats });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-8 w-8 text-brand-500" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  const stats = query.data;
  const roleEntries = Object.entries(stats.usersByRole || {});

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={T.totalUsers} value={stats.totalUsers} />
        <StatCard
          label={T.pendingApprovals}
          value={stats.pendingApprovals}
          tone={stats.pendingApprovals > 0 ? 'text-amber-600 dark:text-amber-400' : ''}
        />
        <StatCard label={T.totalOrders} value={stats.totalOrders} />
        <StatCard label={T.activeOrders} value={stats.activeOrders} />
      </div>

      {roleEntries.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-bold">{T.usersByRole}</h2>
          <div className="flex flex-wrap gap-2">
            {roleEntries.map(([role, count]) => (
              <span
                key={role}
                className="chip bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-ink-50"
              >
                {roleLabel(role)}: <Ltr>{count}</Ltr>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-bold">{T.recentActivity}</h2>
        {stats.recentActivity.length === 0 ? (
          <EmptyState>—</EmptyState>
        ) : (
          <ul>
            {stats.recentActivity.map((log) => (
              <ActivityItem key={log.id} log={log} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
