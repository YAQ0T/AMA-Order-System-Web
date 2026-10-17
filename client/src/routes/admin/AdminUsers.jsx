import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as adminApi from '../../api/admin';
import { T, roleLabel } from '../../lib/labels';
import { ConfirmDialog, EmptyState, ErrorState, Ltr, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../store/auth';

/**
 * An approved user is active. Not approved and never approved: waiting. Not
 * approved but approved once (approvedAt set): deactivated by an admin - see
 * routes/admin.js.
 */
const userState = (user) => {
  if (user.role === 'admin' || user.isApproved) return 'active';
  return user.approvedAt ? 'deactivated' : 'pending';
};

const STATE_CHIP = {
  active: ['bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300', T.userActive],
  pending: ['bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300', T.userPending],
  deactivated: ['bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200', T.userDeactivated],
};

function ResetPasswordModal({ user, onClose }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const reset = useMutation({
    mutationFn: () => adminApi.resetUserPassword(user.id, password),
    onSuccess: () => {
      toast.success(T.passwordReset);
      onClose();
    },
    onError: (err) => setError(err?.message || T.somethingWentWrong),
  });

  return (
    <Modal open onClose={onClose} title={T.resetPasswordFor(user.username)}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (password.length < 6) return setError(T.passwordTooShort);
          reset.mutate();
        }}
      >
        <p className="text-sm text-slate-600 dark:text-ink-400">{T.resetPasswordHint}</p>
        <div>
          <label className="label" htmlFor="reset-pw">
            {T.newPassword}
          </label>
          <input
            id="reset-pw"
            type="text"
            className="input"
            dir="ltr"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        {error && <p className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {T.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={reset.isPending}>
            {reset.isPending ? <Spinner className="h-4 w-4" /> : null}
            {T.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function AdminUsers() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuth((s) => s.user);
  const [deleting, setDeleting] = useState(null);
  const [deactivating, setDeactivating] = useState(null);
  const [resetting, setResetting] = useState(null);

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
      toast.success(T.userActivatedToast);
      invalidate();
    },
    onError: (err) => toast.error(err?.message || T.somethingWentWrong),
  });

  const deactivate = useMutation({
    mutationFn: adminApi.deactivateUser,
    onSuccess: (data) => {
      const n = Number(data?.activeAssignments) || 0;
      if (n > 0) toast.error(T.userDeactivatedWithOrders(n));
      else toast.success(T.userDeactivatedToast);
      invalidate();
    },
    onError: (err) => toast.error(err?.message || T.somethingWentWrong),
  });

  const removeUser = useMutation({
    mutationFn: adminApi.deleteUser,
    onSuccess: () => {
      toast.success(T.deleted);
      invalidate();
    },
    // A 409 means the user has history: the (translated) message says to
    // deactivate instead.
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
              {users.map((user) => {
                const state = userState(user);
                const [chipClass, chipLabel] = STATE_CHIP[state];
                const isMe = user.id === me?.id;
                const isAdmin = user.role === 'admin';
                return (
                  <tr
                    key={user.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-700/60"
                  >
                    <td className="py-2 font-bold">{user.username}</td>
                    <td className="py-2">{roleLabel(user.role)}</td>
                    <td className="py-2">
                      <span className={`chip ${chipClass}`}>{chipLabel}</span>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {state === 'pending' && (
                          <button
                            type="button"
                            className="btn-primary px-2 py-1 text-xs"
                            onClick={() => approve.mutate(user.id)}
                          >
                            {T.approve}
                          </button>
                        )}
                        {state === 'deactivated' && (
                          <button
                            type="button"
                            className="btn-primary px-2 py-1 text-xs"
                            onClick={() => approve.mutate(user.id)}
                          >
                            {T.activate}
                          </button>
                        )}
                        {state === 'active' && !isAdmin && !isMe && (
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() => setDeactivating(user)}
                          >
                            {T.deactivate}
                          </button>
                        )}
                        {/* Your own password is changed from the key button at the top. */}
                        {!isMe && (
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() => setResetting(user)}
                          >
                            {T.resetPassword}
                          </button>
                        )}
                        {!isAdmin && !isMe && (
                          <button
                            type="button"
                            className="btn-danger px-2 py-1 text-xs"
                            onClick={() => setDeleting(user)}
                          >
                            {T.delete}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
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

      <ConfirmDialog
        open={Boolean(deactivating)}
        title={T.deactivate}
        message={deactivating ? T.confirmDeactivate(deactivating.username) : ''}
        confirmLabel={T.deactivate}
        onConfirm={() => {
          deactivate.mutate(deactivating.id);
          setDeactivating(null);
        }}
        onCancel={() => setDeactivating(null)}
      />

      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}
