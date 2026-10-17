import { useState } from 'react';

import { T, statusLabel } from '../lib/labels';
import { formatDateTime, formatPrice, formatQuantity, lineTotal, orderTitle, orderTotal, formatMoney } from '../lib/format';
import { StatusChip, ItemStatusChip, InfoChip, Ltr, EmptyState } from './ui';

const ALL_STATUSES = ['pending', 'in-progress', 'completed', 'archived', 'entered_erp'];

function ItemsTable({ order, showPrices, onItemStatus, busyItems, onItemEdit, onItemAdd }) {
  const items = order.Items || [];
  const total = orderTotal(order);

  if (!items.length) {
    return <p className="py-3 text-sm text-slate-500 dark:text-ink-400">{T.atLeastOneItem}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-start text-xs text-slate-500 dark:border-slate-700 dark:text-ink-400">
            <th className="w-8 py-2 text-start font-bold">#</th>
            <th className="py-2 text-start font-bold">{T.itemName}</th>
            <th className="w-20 py-2 text-start font-bold">{T.quantity}</th>
            {showPrices && <th className="w-24 py-2 text-start font-bold">{T.price}</th>}
            {showPrices && <th className="w-24 py-2 text-start font-bold">{T.total}</th>}
            <th className="w-28 py-2 text-start font-bold">{T.status}</th>
            {(onItemStatus || onItemEdit) && <th className="w-44 py-2 text-start font-bold">{T.actions}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={item.name}
              className={[
                'border-b border-slate-100 last:border-0 dark:border-slate-700/60',
                item.status === 'unavailable' ? 'bg-red-50/60 dark:bg-red-500/5' : '',
                item.status === 'collected' ? 'bg-emerald-50/60 dark:bg-emerald-500/5' : '',
              ].join(' ')}
            >
              <td className="py-2 text-slate-400">
                <Ltr>{index + 1}</Ltr>
              </td>
              <td className="py-2 font-semibold">{item.name}</td>
              <td className="py-2">
                <Ltr>{formatQuantity(item.quantity)}</Ltr>
              </td>
              {showPrices && (
                <td className="py-2">
                  <Ltr>{formatPrice(item.price)}</Ltr>
                </td>
              )}
              {showPrices && (
                <td className="py-2">
                  <Ltr>{formatMoney(lineTotal(item))}</Ltr>
                </td>
              )}
              <td className="py-2">
                <ItemStatusChip status={item.status} />
              </td>
              {(onItemStatus || onItemEdit) && (
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {onItemStatus && (
                      <>
                        <button
                          type="button"
                          disabled={busyItems?.has(`${order.id}:${item.name}`)}
                          onClick={() =>
                            onItemStatus(order, item.name, item.status === 'collected' ? null : 'collected')
                          }
                          className={[
                            'rounded px-2 py-1 text-xs font-bold transition disabled:opacity-40',
                            item.status === 'collected'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300',
                          ].join(' ')}
                        >
                          {T.markCollected}
                        </button>
                        <button
                          type="button"
                          disabled={busyItems?.has(`${order.id}:${item.name}`)}
                          onClick={() =>
                            onItemStatus(order, item.name, item.status === 'unavailable' ? null : 'unavailable')
                          }
                          className={[
                            'rounded px-2 py-1 text-xs font-bold transition disabled:opacity-40',
                            item.status === 'unavailable'
                              ? 'bg-red-600 text-white'
                              : 'bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-300',
                          ].join(' ')}
                        >
                          {T.markUnavailable}
                        </button>
                      </>
                    )}
                    {onItemEdit && (
                      <button
                        type="button"
                        onClick={() => onItemEdit(order, item)}
                        className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-ink-400 dark:hover:bg-slate-700"
                      >
                        {T.edit}
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {showPrices && total > 0 && (
          <tfoot>
            <tr className="border-t-2 border-slate-300 dark:border-slate-600">
              <td colSpan={3} className="py-2 text-end font-bold">
                {T.grandTotal}
              </td>
              <td colSpan={2} className="py-2 font-bold">
                <Ltr>{formatMoney(total)}</Ltr>
              </td>
              <td />
              {(onItemStatus || onItemEdit) && <td />}
            </tr>
          </tfoot>
        )}
      </table>

      {onItemAdd && (
        <button
          type="button"
          onClick={() => onItemAdd(order)}
          className="btn-ghost mt-2 text-xs"
        >
          + {T.addItem}
        </button>
      )}
    </div>
  );
}

function HistoryList({ history }) {
  if (!history?.length) {
    return <p className="py-2 text-sm text-slate-500 dark:text-ink-400">—</p>;
  }
  return (
    <ul className="flex flex-col gap-2 py-2">
      {history.map((entry) => (
        <li key={entry.id} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-ink-950/50">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-slate-500 dark:text-ink-400">
            <span className="font-bold">{entry.Editor?.username || '—'}</span>
            <Ltr>{formatDateTime(entry.createdAt)}</Ltr>
          </div>
          <p className="text-slate-700 dark:text-ink-50">{entry.newDescription}</p>
        </li>
      ))}
    </ul>
  );
}

function OrderCard({
  order,
  showPrices,
  showHistory,
  onEdit,
  onDelete,
  onPrint,
  onStatusChange,
  onItemStatus,
  busyItems,
  onItemEdit,
  onItemAdd,
  onSendToErp,
  statusOptions,
  selectable,
  selected,
  onToggleSelect,
  extraActions,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <article className="card mb-3 p-4">
      <header className="mb-3 flex flex-wrap items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggleSelect?.(order, e.target.checked)}
            className="mt-1 h-4 w-4 accent-brand-500"
            aria-label={orderTitle(order)}
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold">{orderTitle(order)}</h3>
            <span className="text-xs text-slate-400">
              #<Ltr>{order.id}</Ltr>
            </span>
          </div>

          <div className="mb-2 text-xs text-slate-500 dark:text-ink-400">
            {T.sentAt}: <Ltr>{formatDateTime(order.createdAt)}</Ltr>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <StatusChip status={order.status} />
            {order.city && <InfoChip>{order.city}</InfoChip>}
            {order.Maker && (
              <InfoChip>
                {T.maker}: {order.Maker.username}
              </InfoChip>
            )}
            {order.AssignedTakers?.length > 0 && (
              <InfoChip>
                {T.takers}: {order.AssignedTakers.map((t) => t.username).join('، ')}
              </InfoChip>
            )}
            {order.Accounter && (
              <InfoChip>
                {T.accounter}: {order.Accounter.username}
              </InfoChip>
            )}
          </div>

          {order.description && (
            <p className="mt-2 text-sm text-slate-600 dark:text-ink-400">{order.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {onSendToErp && order.status === 'completed' && (
            <button type="button" className="btn-primary text-xs" onClick={() => onSendToErp(order)}>
              {T.sendToErp}
            </button>
          )}
          {extraActions?.(order)}
          {onPrint && (
            <button type="button" className="btn-secondary text-xs" onClick={() => onPrint(order)}>
              {T.print}
            </button>
          )}
          {onEdit && (
            <button type="button" className="btn-secondary text-xs" onClick={() => onEdit(order)}>
              {T.edit}
            </button>
          )}
          {onStatusChange && (
            <select
              className="input w-auto py-1.5 text-xs"
              value={order.status}
              onChange={(e) => onStatusChange(order, e.target.value)}
              aria-label={T.changeStatus}
            >
              {(statusOptions || ALL_STATUSES).map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          )}
          {onDelete && (
            <button type="button" className="btn-danger text-xs" onClick={() => onDelete(order)}>
              {T.delete}
            </button>
          )}
        </div>
      </header>

      <ItemsTable
        order={order}
        showPrices={showPrices}
        onItemStatus={onItemStatus}
        busyItems={busyItems}
        onItemEdit={onItemEdit}
        onItemAdd={onItemAdd}
      />

      {showHistory && (
        <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-700/60">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-xs font-bold text-brand-600 hover:underline dark:text-indigo"
          >
            {historyOpen ? T.hideHistory : T.showHistory}
            {order.History?.length ? ` (${order.History.length})` : ''}
          </button>
          {historyOpen && <HistoryList history={order.History} />}
        </div>
      )}
    </article>
  );
}

export default function OrderTable({ orders, emptyMessage, ...props }) {
  if (!orders?.length) {
    return <EmptyState>{emptyMessage || T.noOrders}</EmptyState>;
  }

  return (
    <div>
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} {...props} />
      ))}
    </div>
  );
}
