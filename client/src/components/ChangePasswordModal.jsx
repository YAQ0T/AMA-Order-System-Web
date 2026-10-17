import { useState } from 'react';

import { useAuth } from '../store/auth';
import { T } from '../lib/labels';
import { useToast } from './Toast';
import { Modal, Spinner } from './ui';

const MIN_LENGTH = 6;

/**
 * Change your own password. Mounted only while open, so it starts empty each time.
 */
export default function ChangePasswordModal({ onClose }) {
  const toast = useToast();
  const changePassword = useAuth((s) => s.changePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_LENGTH) return setError(T.passwordTooShort);
    if (next !== confirm) return setError(T.passwordsDontMatch);

    setBusy(true);
    try {
      await changePassword(current, next);
      toast.success(T.passwordChanged);
      onClose();
    } catch (err) {
      setError(err?.message || T.somethingWentWrong);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={T.changePassword}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="pw-current">
            {T.currentPassword}
          </label>
          <input
            id="pw-current"
            type="password"
            className="input"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pw-new">
            {T.newPassword}
          </label>
          <input
            id="pw-new"
            type="password"
            className="input"
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pw-confirm">
            {T.confirmPassword}
          </label>
          <input
            id="pw-confirm"
            type="password"
            className="input"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {error && <p className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {T.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : null}
            {T.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
