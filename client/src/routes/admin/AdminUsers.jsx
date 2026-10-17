import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as adminApi from '../../api/admin';
import { T, roleLabel } from '../../lib/labels';
import { ConfirmDialog, EmptyState, ErrorState, Ltr, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function AdminUsers() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(null);

  const usersQuery = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.fetchUsers });
  const pendingQuery = useQuery({
    queryKey: ['admin', 'users', 'pending'],
    queryFn: adminApi.fetchPendingUsers,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  const approve = useMutation({
    mutationFn: adminApi.approveUser,
    onSuccess: () => {
      toast.success(T.approved);
      invalidate();
    },
    onError: (err) => toast.error(err?.message || T.somethingWentWrong),
  });

  const removeUser = useMutation({
    mutationFn: adminApi.deleteUser,
    onSuccess: () => {
      toast.success(T.delete);
      invalidate();
    },
    onError: (err) => toast.error(err?.message || T.somethingWentWrong),
  });

  if (usersQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-8 w-8 text-brand-500" />
      </div>
    );
  }
  if (usersQuery.isError) return <ErrorState error={usersQuery.error} onRetry={usersQuery.refetch} />;

  const pending = pendingQuery.data ?? [];
  const users = usersQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold">
          {T.pendingApprovals} {pending.length > 0 && <>(<Ltr>{pending.length}</Ltr>)</>}
        </h2>

        {pending.length === 0 ? (
          <EmptyState>{T.noPending}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {pending.map((user) => (
              <li key={user.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{user.username}</p>
                  <p className="text-xs text-slate-500 dark:text-ink-400">{roleLabel(user.role)}</p>
                </div>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(user.id)}
                >
                  {T.approve}
                </button>
                <button
                  type="button"
                  className="btn-danger text-xs"
                  onClick={() => setDeleting(user)}
                >
                  {T.delete}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold">
          {T.users} (<Ltr>{users.length}</Ltr>)
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-ink-400">
                <th className="py-2 text-start font-bold">{T.username}</th>
                <th className="py-2 text-start font-bold">{T.role}</th>
                <th className="py-2 text-start font-bold">{T.status}</th>
                <th className="py-2 text-start font-bold">{T.actions}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-700/60"
                >
                  <td className="py-2 font-bold">{user.username}</td>
                  <td className="py-2">{roleLabel(user.role)}</td>
                  <td className="py-2">
                    {user.isApproved ? (
                      <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                        {T.approved}
                      </span>
                    ) : (
                      <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                        {T.pendingApprovals}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1.5">
                      {!user.isApproved && (
                        <button
                          type="button"
                          className="btn-primary px-2 py-1 text-xs"
                          onClick={() => approve.mutate(user.id)}
                        >
                          {T.approve}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-danger px-2 py-1 text-xs"
                        onClick={() => setDeleting(user)}
                      >
                        {T.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={T.deleteUser}
        message={deleting ? `${deleting.username} — ${T.confirmDeleteUser}` : ''}
        confirmLabel={T.delete}
        onConfirm={() => {
          removeUser.mutate(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
