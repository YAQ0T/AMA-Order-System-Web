import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';

import { statusLabel, itemStatusLabel, T } from '../lib/labels';

/** Wraps numbers/IDs/dates so bidi reordering can't mangle them in an RTL page. */
export function Ltr({ children, className = '' }) {
  return <span className={`ltr ${className}`}>{children}</span>;
}

const STATUS_CLASSES = {
  pending: 'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-100',
  'in-progress': 'bg-amber-200 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200',
  completed: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-200',
  archived: 'bg-slate-300 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
  entered_erp: 'bg-violet-200 text-violet-900 dark:bg-violet-500/25 dark:text-violet-200',
};

export function StatusChip({ status }) {
  return (
    <span className={`chip ${STATUS_CLASSES[status] || STATUS_CLASSES.pending}`}>
      {statusLabel(status)}
    </span>
  );
}

const ITEM_STATUS_CLASSES = {
  collected: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  unavailable: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
};

export function ItemStatusChip({ status }) {
  if (!status) {
    return <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-ink-400">{itemStatusLabel(null)}</span>;
  }
  return <span className={`chip ${ITEM_STATUS_CLASSES[status]}`}>{itemStatusLabel(status)}</span>;
}

export function InfoChip({ children }) {
  return (
    <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-ink-50">
      {children}
    </span>
  );
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label={T.loading}
    />
  );
}

export function EmptyState({ children }) {
  return (
    <div className="py-12 text-center text-sm text-slate-500 dark:text-ink-400">{children}</div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="card p-6 text-center">
      <p className="mb-3 text-sm font-semibold text-red-600 dark:text-red-400">
        {error?.message || T.somethingWentWrong}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary">
          {T.retry}
        </button>
      )}
    </div>
  );
}

/** Route-backed tabs, so a refresh or a shared link lands on the same tab. */
export function TabLinks({ tabs }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-ink-900">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            [
              'rounded-lg px-4 py-2 text-sm font-bold transition',
              isActive
                ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-ink-50'
                : 'text-slate-600 hover:bg-white/60 dark:text-ink-400 dark:hover:bg-slate-700/50',
            ].join(' ')
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          'max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-ink-900 sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        ].join(' ')}
      >
        {title && <h2 className="mb-4 text-lg font-bold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel, tone = 'danger', onConfirm, onCancel }) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="mb-6 text-sm leading-relaxed text-slate-600 dark:text-ink-400">{message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {T.cancel}
        </button>
        <button
          type="button"
          className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
          onClick={onConfirm}
        >
          {confirmLabel || T.confirm}
        </button>
      </div>
    </Modal>
  );
}
