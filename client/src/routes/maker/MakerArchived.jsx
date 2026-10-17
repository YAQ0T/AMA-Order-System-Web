import { useMemo, useState } from 'react';

import OrderFilters from '../../components/OrderFilters';
import OrderEditModal from '../../components/OrderEditModal';
import Pagination from '../../components/Pagination';
import { ConfirmDialog, EmptyState, ErrorState, Modal, Spinner, Ltr } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useOrdersQuery, useUpdateOrder, useDeleteOrder } from '../../hooks/useOrders';
import { useTakers, useAccounters } from '../../hooks/useUsers';
import { printOrders } from '../../print/printOrders';
import { T, CITIES } from '../../lib/labels';
import { formatDate, orderTitle } from '../../lib/format';

const PAGE_SIZE = 20;

/** Cities in the canonical order from the DB enum, then anything unexpected, then unspecified. */
function groupByCity(orders) {
  const groups = new Map();
  for (const order of orders) {
    const city = (order.city || '').trim() || T.unspecifiedCity;
    if (!groups.has(city)) groups.set(city, []);
    groups.get(city).push(order);
  }

  const ordered = [];
  for (const city of CITIES) {
    if (groups.has(city)) ordered.push([city, groups.get(city)]);
  }
  const extras = [...groups.keys()]
    .filter((c) => !CITIES.includes(c) && c !== T.unspecifiedCity)
    .sort();
  for (const city of extras) ordered.push([city, groups.get(city)]);
  if (groups.has(T.unspecifiedCity)) ordered.push([T.unspecifiedCity, groups.get(T.unspecifiedCity)]);

  return ordered;
}

function SendSheet({ open, onClose, onSend, count, busy }) {
  const { data: takers = [] } = useTakers(open);
  const { data: accounters = [] } = useAccounters(open);
  const [takerIds, setTakerIds] = useState([]);
  const [accounterId, setAccounterId] = useState('');

  const canSend = takerIds.length > 0 && accounterId !== '';

  return (
    <Modal open={open} onClose={onClose} title={`${T.sendOrders} (${count})`}>
      <div className="mb-4">
        <span className="label">{T.assignTakers}</span>
        {takers.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-ink-400">—</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {takers.map((taker) => {
              const selected = takerIds.includes(taker.id);
              return (
                <button
                  key={taker.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setTakerIds((c) =>
                      c.includes(taker.id) ? c.filter((t) => t !== taker.id) : [...c, taker.id]
                    )
                  }
                  className={[
                    'rounded-lg border px-3 py-1.5 text-sm font-bold transition',
                    selected
                      ? 'border-brand-500 bg-brand-500 text-white dark:border-indigo dark:bg-indigo'
                      : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-ink-900 dark:text-ink-50',
                  ].join(' ')}
                >
                  {taker.username}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-6">
        <label className="label" htmlFor="send-accounter">
          {T.accounter}
        </label>
        <select
          id="send-accounter"
          className="input"
          value={accounterId}
          onChange={(e) => setAccounterId(e.target.value)}
        >
          <option value="">{T.selectAccounter}</option>
          {accounters.map((a) => (
            <option key={a.id} value={a.id}>
              {a.username}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          {T.cancel}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!canSend || busy}
          onClick={() => onSend({ takerIds, accounterId: Number(accounterId) })}
        >
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {T.send}
        </button>
      </div>
    </Modal>
  );
}

export default function MakerArchived() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const query = useOrdersQuery({
    status: 'archived',
    search,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    includeHistory: false,
  });

  const updateOrder = useUpdateOrder();
  const deleteOrder = useDeleteOrder();

  const total = query.data?.pagination?.total ?? 0;
  // ?? [] would allocate a new array each render and defeat the memo below.
  const orders = useMemo(() => query.data?.orders ?? [], [query.data]);
  const grouped = useMemo(() => groupByCity(orders), [orders]);

  const selectedOrders = orders.filter((o) => selected.has(o.id));

  const toggle = (order, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(order.id);
      else next.delete(order.id);
      return next;
    });
  };

  const toggleGroup = (groupOrders) => {
    const allSelected = groupOrders.every((o) => selected.has(o.id));
    setSelected((current) => {
      const next = new Set(current);
      for (const order of groupOrders) {
        if (allSelected) next.delete(order.id);
        else next.add(order.id);
      }
      return next;
    });
  };

  const send = async ({ takerIds, accounterId }) => {
    setSending(true);
    try {
      // The server has no bulk status endpoint, so this is one PUT per order.
      // skipEmail suppresses the per-order email; the assignment emails are
      // still sent by the server when the order moves to pending.
      for (const order of selectedOrders) {
        await updateOrder.mutateAsync({
          id: order.id,
          payload: {
            status: 'pending',
            assignedTakerIds: takerIds,
            accounterId,
          },
        });
      }
      toast.success(T.ordersSent);
      setSelected(new Set());
      setSendOpen(false);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setSending(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteOrder.mutateAsync(deleting.id);
      toast.success(T.delete);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setDeleting(null);
    }
  };

  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <div>
      <OrderFilters
        status="archived"
        statusEnabled={false}
        allowedStatuses={['archived']}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
      />

      {selected.size > 0 && (
        <div className="sticky top-16 z-30 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3 dark:border-indigo/40 dark:bg-indigo/10">
          <span className="text-sm font-bold">
            <Ltr>{selected.size}</Ltr> {T.selectAll}
          </span>
          <div className="flex-1" />
          <button type="button" className="btn-secondary text-xs" onClick={() => setSelected(new Set())}>
            {T.clearSelection}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => printOrders(selectedOrders, { showPrices: true })}
          >
            {T.printSelected}
          </button>
          <button type="button" className="btn-primary text-xs" onClick={() => setSendOpen(true)}>
            {T.sendSelected}
          </button>
        </div>
      )}

      {query.isFetching && (
        <div className="mb-2 flex justify-center">
          <Spinner className="h-5 w-5 text-brand-500" />
        </div>
      )}

      {orders.length === 0 && !query.isFetching ? (
        <EmptyState>{T.noArchived}</EmptyState>
      ) : (
        grouped.map(([city, groupOrders]) => {
          const allSelected = groupOrders.every((o) => selected.has(o.id));
          return (
            <section key={city} className="card mb-3 p-4">
              <header className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold">
                  {city} (<Ltr>{groupOrders.length}</Ltr>)
                </h3>
                <div className="flex-1" />
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => toggleGroup(groupOrders)}
                >
                  {allSelected ? T.clearSelection : T.selectAll}
                </button>
              </header>

              <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {groupOrders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-500"
                      checked={selected.has(order.id)}
                      onChange={(e) => toggle(order, e.target.checked)}
                      aria-label={orderTitle(order)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{orderTitle(order)}</p>
                      <p className="text-xs text-slate-500 dark:text-ink-400">
                        {T.itemCount(order.Items?.length || 0)} — {T.createdOn}{' '}
                        <Ltr>{formatDate(order.createdAt)}</Ltr>
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => printOrders(order, { showPrices: true })}
                      >
                        {T.print}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => setEditing(order)}
                      >
                        {T.edit}
                      </button>
                      <button
                        type="button"
                        className="btn-danger text-xs"
                        onClick={() => setDeleting(order)}
                      >
                        {T.delete}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      <SendSheet
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onSend={send}
        count={selected.size}
        busy={sending}
      />

      {editing && (
        <OrderEditModal
          key={editing.id}
          order={editing}
          open
          onClose={() => setEditing(null)}
          showPrices
          canAssign
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={T.delete}
        message={deleting ? `${orderTitle(deleting)} — ${T.confirmDeleteOrder}` : ''}
        confirmLabel={T.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
