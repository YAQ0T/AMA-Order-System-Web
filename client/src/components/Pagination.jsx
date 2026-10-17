import { Ltr } from './ui';

/**
 * The server caps page size at 20 (order_helpers.js), so there is no
 * "show 100 per page" option to offer - only paging.
 */
export default function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500 dark:text-ink-400">
        <Ltr>{`${from}–${to}`}</Ltr> / <Ltr>{total}</Ltr>
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-xs"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          ‹
        </button>
        <span className="text-xs font-bold">
          <Ltr>{`${page + 1} / ${pages}`}</Ltr>
        </span>
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-xs"
          disabled={page + 1 >= pages}
          onClick={() => onChange(page + 1)}
        >
          ›
        </button>
      </div>
    </nav>
  );
}
