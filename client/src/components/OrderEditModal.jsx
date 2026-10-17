import { useState } from 'react';

import { T, CITIES } from '../lib/labels';
import { parseNumber, formatQuantity } from '../lib/format';
import { useTakers, useAccounters } from '../hooks/useUsers';
import { useUpdateOrder } from '../hooks/useOrders';
import { isOpenOrder } from '../api/orders';
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
  quantity: '1',
  price: '',
  status: null,
});

/**
 * Call sites mount this with key={order.id} and unmount it when closed, so the
 * form seeds itself from props once. That is why there is no reset effect here.
 */
export default function OrderEditModal({ order, open, onClose, showPrices = true, canAssign = true }) {
  const toast = useToast();
  const updateOrder = useUpdateOrder();
  const { data: takers = [] } = useTakers(open && canAssign);
  const { data: accounters = [] } = useAccounters(open && canAssign);

  const [title, setTitle] = useState(order?.title || '');
  const [description, setDescription] = useState(order?.description || '');
  const [city, setCity] = useState(order?.city || '');
  const [rows, setRows] = useState(() => (order?.Items || []).map(toRow));
  const [takerIds, setTakerIds] = useState(() => (order?.AssignedTakers || []).map((t) => t.id));
  const [openToAll, setOpenToAll] = useState(() => isOpenOrder(order));
  const [accounterId, setAccounterId] = useState(
    order?.accounterId ? String(order.accounterId) : order?.Accounter?.id ? String(order.Accounter.id) : ''
  );
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

    const cleaned = [];
    const seen = new Set();

    for (const row of rows) {
      const name = row.name.trim();
      if (!name) continue;
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
      description: description.trim() || null,
      city: city || null,
      items: cleaned,
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
      payload.accounterId = accounterId ? Number(accounterId) : null;
    }

    try {
      await updateOrder.mutateAsync({ id: order.id, payload });
      toast.success(T.saved);
      onClose();
    } catch (err) {
      setError(err?.message || T.somethingWentWrong);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`${T.editOrder} #${order.id}`} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
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
          <div className="grid gap-4 sm:grid-cols-2">
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

            <div>
              <label className="label" htmlFor="edit-accounter">
                {T.accounter}
              </label>
              <select
                id="edit-accounter"
                className="input"
                value={accounterId}
                onChange={(e) => setAccounterId(e.target.value)}
              >
                <option value="">{T.none}</option>
                {accounters.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.username}
                  </option>
                ))}
              </select>
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
