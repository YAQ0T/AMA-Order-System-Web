import { useState } from 'react';

import { T, CITIES } from '../lib/labels';
import { parseNumber, formatQuantity, orderDescription } from '../lib/format';
import { useTakers } from '../hooks/useUsers';
import { useUpdateOrder } from '../hooks/useOrders';
import { isOpenOrder, itemsPayload } from '../api/orders';
import { useAuth } from '../store/auth';
import { useToast } from './Toast';
import { Modal, Spinner } from './ui';
import ItemNameInput from './ItemNameInput';

// Keyed by name, not id: ids rotate on every save, and name is what the server
// matches on. Names are unique within an order (sanitizeItems rejects dupes).
const toRow = (item) => ({
  key: `existing-${item.name}`,
  originalName: item.name,
  name: item.name,
  quantity: formatQuantity(item.quantity),
  price: item.price == null ? '' : String(item.price),
  status: item.status ?? null,
});

const newRow = () => ({
  key: `new-${Math.random().toString(36).slice(2)}`,
  originalName: null,
  name: '',
  quantity: '',
  price: '',
  status: null,
});

const FINISHED = ['completed', 'entered_erp'];

/** What to say after a save - based on what the server did, not on what was sent. */
function savedMessage(order, saved) {
  // A finished order whose items changed went back to its takers.
  if (FINISHED.includes(order.status) && ['pending', 'in-progress'].includes(saved?.status)) {
    return T.sentBackToTakers;
  }
  // Changed after ERP: the server wrote its marker in the history (only when
  // something really changed) and told the accountant who entered it.
  const newestBefore = Math.max(0, ...(order.History || []).map((h) => h.id));
  const markedNow = (saved?.History || []).some(
    (h) => h.id > newestBefore && h.newDescription === 'Changed after it was entered into ERP'
  );
  if (order.status === 'entered_erp' && saved?.status === 'entered_erp' && saved?.Accounter && markedNow) {
    return T.savedAccountantTold;
  }
  return T.saved;
}

/**
 * Call sites mount this with key={order.id} and unmount it when closed, so the
 * form seeds itself from props once. That is why there is no reset effect here.
 */
export default function OrderEditModal({ order, open, onClose, showPrices = true, canAssign = true }) {
  const toast = useToast();
  const updateOrder = useUpdateOrder();
  const { data: takers = [] } = useTakers(open && canAssign);

  const [title, setTitle] = useState(order?.title || '');
  // What the box starts with: the old English filler shows as empty.
  const initialDescription = orderDescription(order);
  const [description, setDescription] = useState(initialDescription);
  const [city, setCity] = useState(order?.city || '');
  const [rows, setRows] = useState(() => (order?.Items || []).map(toRow));
  const [takerIds, setTakerIds] = useState(() => (order?.AssignedTakers || []).map((t) => t.id));
  const [openToAll, setOpenToAll] = useState(() => isOpenOrder(order));
  const [isOnline, setIsOnline] = useState(Boolean(order?.isOnline));
  const [isUrgent, setIsUrgent] = useState(Boolean(order?.isUrgent));
  // "Online" is the maker's mark (canAssign = maker or admin); "urgent" is the admin's.
  const isAdmin = useAuth((st) => st.user?.role === 'admin');
  const [error, setError] = useState(null);

  if (!order) return null;

  // "Open to any taker" only means something for an order that is live for
  // takers. An archived order gets its takers when it is sent out.
  const isActive = order.status === 'pending' || order.status === 'in-progress';

  const updateRow = (key, patch) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key) => setRows((current) => current.filter((r) => r.key !== key));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!city) {
      setError(T.needCityToast);
      return;
    }

    const cleaned = [];
    const seen = new Set();

    for (const row of rows) {
      const name = row.name.trim();
      if (!name) continue;
      if (String(row.quantity).trim() === '') {
        setError(T.needQuantityToast(name));
        return;
      }
      const qty = parseNumber(row.quantity);
      if (qty === null || qty <= 0) {
        setError(`${T.invalidQuantity}: ${name}`);
        return;
      }
      const hasPrice = String(row.price).trim() !== '';
      const price = hasPrice ? parseNumber(row.price) : null;
      if (hasPrice && price === null) {
        setError(`${T.invalidPrice}: ${name}`);
        return;
      }
      if (seen.has(name.toLowerCase())) {
        setError(`${T.duplicateItem}: ${name}`);
        return;
      }
      seen.add(name.toLowerCase());

      // Leave `status` out for items that keep their name: the server then
      // preserves each item's CURRENT status, read after it locks the order.
      // A taker may have ticked items while this modal was open, and sending
      // the statuses we loaded would silently overwrite their work.
      //
      // A RENAMED item is new as far as the server is concerned (it matches by
      // name), so it would come back with no status - carry it across.
      const renamed = row.originalName != null && row.originalName !== name;
      cleaned.push({
        name,
        quantity: qty,
        price,
        ...(renamed ? { status: row.status ?? null } : {}),
      });
    }

    if (!cleaned.length) {
      setError(T.atLeastOneItem);
      return;
    }

    const payload = {
      title: title.trim() || null,
      // Sent only when edited: an emptied box clears the description, an
      // untouched one leaves it (and the order history) alone.
      ...(description.trim() !== initialDescription ? { description: description.trim() || null } : {}),
      city: city || null,
      items: cleaned,
      // The items as this window first showed them. The server applies only
      // what was changed here, and keeps what takers changed meanwhile.
      baseItems: itemsPayload(order.Items),
    };

    if (canAssign) {
      if (isActive && openToAll) {
        payload.openToAll = true;
        payload.assignedTakerIds = [];
      } else {
        if (isActive && takerIds.length === 0) {
          setError(T.needTaker);
          return;
        }
        payload.assignedTakerIds = takerIds;
      }
      payload.isOnline = isOnline;
      if (isAdmin) payload.isUrgent = isUrgent;
    }

    try {
      const saved = await updateOrder.mutateAsync({ id: order.id, payload });
      toast.success(savedMessage(order, saved));
      onClose();
    } catch (err) {
      setError(err?.message || T.somethingWentWrong);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`${T.editOrder} #${order.id}`} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {FINISHED.includes(order.status) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {order.status === 'entered_erp' ? T.erpEditNote : T.reopenNote}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="edit-title">
              {T.customerName}
            </label>
            <input
              id="edit-title"
              className="input"
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-city">
              {T.city}
            </label>
            <select id="edit-city" className="input" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">{T.selectCity}</option>
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="edit-description">
            {T.description}
          </label>
          <textarea
            id="edit-description"
            className="input"
            maxLength={5000}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {canAssign && (
            <div className="mt-2 flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-sky-800 dark:text-sky-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-sky-600"
                  checked={isOnline}
                  onChange={(e) => setIsOnline(e.target.checked)}
                />
                {T.onlineOrder}
              </label>
              {isAdmin && (
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-red-700 dark:text-red-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-red-600"
                    checked={isUrgent}
                    onChange={(e) => setIsUrgent(e.target.checked)}
                  />
                  {T.urgentOrderLong}
                </label>
              )}
            </div>
          )}
        </div>

        <fieldset>
          <legend className="label">{T.items}</legend>
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className={`grid items-start gap-2 ${showPrices ? 'grid-cols-[1fr_5rem_6rem_2.5rem]' : 'grid-cols-[1fr_5rem_2.5rem]'}`}
              >
                <ItemNameInput
                  value={row.name}
                  onChange={(name) => updateRow(row.key, { name })}
                  aria-label={T.itemName}
                  maxLength={255}
                />
                <input
                  className="input text-center"
                  inputMode="decimal"
                  value={row.quantity}
                  aria-label={T.quantity}
                  onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                />
                {showPrices && (
                  <input
                    className="input text-center"
                    inputMode="decimal"
                    value={row.price}
                    aria-label={T.price}
                    placeholder={T.price}
                    onChange={(e) => updateRow(row.key, { price: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  className="btn-ghost h-[38px] px-2 text-red-500"
                  onClick={() => removeRow(row.key)}
                  aria-label={T.removeItem}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn-ghost mt-2 text-sm"
            onClick={() => setRows((c) => [...c, newRow()])}
          >
            + {T.addItem}
          </button>
        </fieldset>

        {canAssign && (
          <div>
            <div>
              <span className="label">{T.assignTakers}</span>
              {isActive && (
                <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-amber-500"
                    checked={openToAll}
                    onChange={(e) => setOpenToAll(e.target.checked)}
                  />
                  {T.openToAll}
                </label>
              )}
              {isActive && openToAll ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  {order.status === 'in-progress' && order.AssignedTakers?.length
                    ? T.openToAllReleaseHint
                    : T.openToAllHint}
                </p>
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
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        )}

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
