import { useState } from 'react';

import OrderFilters from '../../components/OrderFilters';
import OrderTable from '../../components/OrderTable';
import Pagination from '../../components/Pagination';
import { ConfirmDialog, ErrorState, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useOrdersQuery, useUpdateOrder, useUpdateItemStatus } from '../../hooks/useOrders';
import * as ordersApi from '../../api/orders';
import { T } from '../../lib/labels';
import { parseNumber, formatQuantity } from '../../lib/format';
import ItemNameInput from '../../components/ItemNameInput';
import TelegramLinkCard from '../../components/TelegramLinkCard';

const PAGE_SIZE = 20;

/**
 * Takers advance an order pending -> in-progress -> completed.
 * The server refuses to show them completed or entered_erp orders at all
 * (order_helpers.js forces the filter), so those never appear here.
 */
const NEXT_STATUS = {
  pending: 'in-progress',
  'in-progress': 'completed',
};

function AddItemModal({ order, open, onClose }) {
  const toast = useToast();
  const updateOrder = useUpdateOrder();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    const qty = parseNumber(quantity);

    if (!trimmed) return setError(T.required);
    if (qty === null || qty <= 0) return setError(T.invalidQuantity);

    const exists = (order.Items || []).some(
      (i) => i.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) return setError(T.duplicateItem);

    try {
      await updateOrder.mutateAsync({
        id: order.id,
        payload: {
          items: [
            ...ordersApi.itemsPayload(order.Items),
            { name: trimmed, quantity: qty, price: null, status: null },
          ],
        },
      });
      toast.success(T.addItem);
      setName('');
      setQuantity('1');
      onClose();
    } catch (err) {
      setError(err?.message || T.somethingWentWrong);
    }
  };

  if (!order) return null;

  return (
    <Modal open={open} onClose={onClose} title={T.addItem}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="add-item-name">
            {T.itemName}
          </label>
          <ItemNameInput id="add-item-name" value={name} onChange={setName} />
        </div>
        <div>
          <label className="label" htmlFor="add-item-qty">
            {T.quantity}
          </label>
          <input
            id="add-item-qty"
            className="input"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>

        {error && <p className="text-sm font-bold text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {T.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={updateOrder.isPending}>
            {updateOrder.isPending ? <Spinner className="h-4 w-4" /> : null}
            {T.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditItemModal({ order, item, open, onClose }) {
  const toast = useToast();
  const updateOrder = useUpdateOrder();
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState(null);

  // Reset when a different item is opened.
  const [lastItemKey, setLastItemKey] = useState(null);
  if (item && item.name !== lastItemKey) {
    setLastItemKey(item.name);
    setQuantity(formatQuantity(item.quantity));
    setError(null);
  }

  if (!order || !item) return null;

  const submit = async (e) => {
    e.preventDefault();
    const qty = parseNumber(quantity);
    if (qty === null || qty <= 0) return setError(T.invalidQuantity);

    try {
      await updateOrder.mutateAsync({
        id: order.id,
        payload: {
          // Match by name: item ids rotate on every save (destroy + bulkCreate
          // in routes/orders.js), so a held id is routinely stale.
          items: ordersApi.itemsPayload(
            (order.Items || []).map((i) => (i.name === item.name ? { ...i, quantity: qty } : i))
          ),
        },
      });
      toast.success(T.save);
      onClose();
    } catch (err) {
      setError(err?.message || T.somethingWentWrong);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`${T.edit}: ${item.name}`}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="edit-item-qty">
            {T.quantity}
          </label>
          <input
            id="edit-item-qty"
            className="input"
            inputMode="decimal"
            value={quantity}
            autoFocus
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>

        {error && <p className="text-sm font-bold text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {T.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={updateOrder.isPending}>
            {T.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function TakerDashboard() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(0);
  const [addingTo, setAddingTo] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [advancing, setAdvancing] = useState(null);
  // Keyed by item NAME, because ids rotate on every save (see useUpdateItemStatus).
  const [busyItems, setBusyItems] = useState(() => new Set());

  const query = useOrdersQuery({
    status,
    search,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const updateOrder = useUpdateOrder();
  const itemStatus = useUpdateItemStatus();

  const orders = query.data?.orders ?? [];
  const total = query.data?.pagination?.total ?? 0;

  const onItemStatus = async (order, itemName, nextStatus) => {
    const key = `${order.id}:${itemName}`;
    setBusyItems((current) => new Set(current).add(key));
    try {
      await itemStatus.mutateAsync({ order, itemName, status: nextStatus });
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setBusyItems((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const advance = async () => {
    if (!advancing) return;
    const next = NEXT_STATUS[advancing.status];
    if (!next) return setAdvancing(null);

    try {
      await updateOrder.mutateAsync({ id: advancing.id, payload: { status: next } });
      toast.success(T.save);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setAdvancing(null);
    }
  };

  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <div>
      <TelegramLinkCard />

      <OrderFilters
        status={status}
        onStatusChange={(value) => {
          setStatus(value);
          setPage(0);
        }}
        allowedStatuses={['active', 'pending', 'in-progress']}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
      />

      {query.isFetching && (
        <div className="mb-2 flex justify-center">
          <Spinner className="h-5 w-5 text-brand-500" />
        </div>
      )}

      <OrderTable
        orders={orders}
        /* Takers never see prices - the server strips them from the payload
           anyway (getItemAttributesForRole), so showing the column would
           always render empty. */
        showPrices={false}
        showHistory={false}
        onItemStatus={onItemStatus}
        busyItems={busyItems}
        onItemEdit={(order, item) => setEditingItem({ order, item })}
        onItemAdd={setAddingTo}
        extraActions={(order) =>
          NEXT_STATUS[order.status] ? (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => setAdvancing(order)}
            >
              {order.status === 'pending' ? T.statusStart : T.statusFinish}
            </button>
          ) : null
        }
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      <AddItemModal order={addingTo} open={Boolean(addingTo)} onClose={() => setAddingTo(null)} />

      <EditItemModal
        order={editingItem?.order}
        item={editingItem?.item}
        open={Boolean(editingItem)}
        onClose={() => setEditingItem(null)}
      />

      <ConfirmDialog
        open={Boolean(advancing)}
        title={T.changeStatus}
        message={
          advancing
            ? `${T.changeStatus}: #${advancing.id} → ${
                NEXT_STATUS[advancing.status] === 'completed' ? T.completed : T.active
              }`
            : ''
        }
        confirmLabel={T.confirm}
        tone="primary"
        onConfirm={advance}
        onCancel={() => setAdvancing(null)}
      />
    </div>
  );
}
