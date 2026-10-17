import { useCallback, useRef, useState } from 'react';

import { T, CITIES, DEFAULT_CITY } from '../lib/labels';
import { parseNumber } from '../lib/format';
import { useShortcuts } from '../lib/shortcuts';
import { useTakers, useAccounters } from '../hooks/useUsers';
import { useCreateOrder } from '../hooks/useOrders';
import { useToast } from './Toast';
import ItemNameInput from './ItemNameInput';
import { Spinner } from './ui';

const emptyItem = () => ({ key: Math.random().toString(36).slice(2), name: '', quantity: '1', price: '' });

/**
 * Names created in this session, suggested before they exist server-side.
 * Mirrors the Flutter OrderNotifier._productCache.
 */
const sessionProductNames = new Set();

export default function OrderForm() {
  const toast = useToast();
  const createOrder = useCreateOrder();
  const { data: takers = [], isLoading: takersLoading } = useTakers();
  const { data: accounters = [], isLoading: accountersLoading } = useAccounters();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState(DEFAULT_CITY);
  const [items, setItems] = useState([emptyItem()]);
  const [takerIds, setTakerIds] = useState([]);
  const [accounterId, setAccounterId] = useState('');
  const [errors, setErrors] = useState({});

  const formRef = useRef(null);
  const itemRefs = useRef({});

  const registerItemRef = (key, field) => (el) => {
    itemRefs.current[`${key}:${field}`] = el;
  };

  const focusItem = (key, field) => {
    requestAnimationFrame(() => itemRefs.current[`${key}:${field}`]?.focus());
  };

  const updateItem = (key, patch) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const addItem = useCallback(() => {
    const item = emptyItem();
    setItems((current) => [...current, item]);
    focusItem(item.key, 'name');
    return item;
  }, []);

  const removeItem = (key) => {
    setItems((current) => (current.length === 1 ? current : current.filter((i) => i.key !== key)));
  };

  const toggleTaker = (id) => {
    setTakerIds((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id]
    );
  };

  const reset = () => {
    setTitle('');
    setDescription('');
    setCity(DEFAULT_CITY);
    setItems([emptyItem()]);
    setTakerIds([]);
    setAccounterId('');
    setErrors({});
    requestAnimationFrame(() => {
      formRef.current?.querySelector('input[name="title"]')?.focus();
    });
  };

  const validate = (archive) => {
    const next = {};

    if (!city.trim()) next.city = T.required;

    const cleaned = [];
    const seen = new Set();

    for (const item of items) {
      const name = item.name.trim();
      const qty = parseNumber(item.quantity);
      const hasPrice = String(item.price).trim() !== '';
      const price = hasPrice ? parseNumber(item.price) : null;

      // Skip rows the user left completely blank.
      if (!name && String(item.quantity).trim() === '') continue;

      if (!name) {
        next[`item:${item.key}:name`] = T.required;
        continue;
      }
      if (qty === null || qty <= 0) {
        next[`item:${item.key}:quantity`] = T.invalidQuantity;
        continue;
      }
      if (hasPrice && price === null) {
        next[`item:${item.key}:price`] = T.invalidPrice;
        continue;
      }
      if (seen.has(name.toLowerCase())) {
        next[`item:${item.key}:name`] = T.duplicateItem;
        continue;
      }
      seen.add(name.toLowerCase());
      cleaned.push({ name, quantity: qty, price });
    }

    if (cleaned.length === 0) next.items = T.atLeastOneItem;

    // Archived orders are drafts - no assignment required yet. Active orders
    // need both, and the server rejects them otherwise (routes/orders.js).
    if (!archive) {
      if (takerIds.length === 0) next.takers = T.needTaker;
      if (!accounterId) next.accounter = T.needAccounter;
    }

    setErrors(next);
    return { valid: Object.keys(next).length === 0, cleaned };
  };

  const submit = async (archive) => {
    if (createOrder.isPending) return;

    const { valid, cleaned } = validate(archive);
    if (!valid) {
      toast.error(T.somethingWentWrong);
      return;
    }

    try {
      await createOrder.mutateAsync({
        title: title.trim() || null,
        description: description.trim() || null,
        city: city.trim(),
        items: cleaned,
        assignedTakerIds: archive ? [] : takerIds,
        accounterId: archive ? null : Number(accounterId),
        ...(archive ? { status: 'archived' } : {}),
      });

      cleaned.forEach((item) => sessionProductNames.add(item.name));
      toast.success(T.orderCreated);
      reset();
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    }
  };

  useShortcuts(
    {
      'ctrl+enter': () => submit(false),
      F3: () => submit(true),
    },
    { target: formRef }
  );

  const busy = createOrder.isPending;

  return (
    <form
      ref={formRef}
      className="card mb-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{T.newOrder}</h2>
        <p className="text-xs text-slate-400">
          {T.keyboardHints}: <span className="ltr">Ctrl+Enter</span> / <span className="ltr">F3</span> /{' '}
          <span className="ltr">F7</span>
        </p>
      </div>

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="order-title">
            {T.customerName}
          </label>
          <input
            id="order-title"
            name="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="label" htmlFor="order-city">
            {T.city}
          </label>
          <select
            id="order-city"
            className="input"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="">{T.selectCity}</option>
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {errors.city && <p className="mt-1 text-xs font-bold text-red-600">{errors.city}</p>}
        </div>
      </div>

      <div className="mb-4">
        <label className="label" htmlFor="order-description">
          {T.description}
        </label>
        <textarea
          id="order-description"
          className="input"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <fieldset className="mb-4">
        <legend className="label">{T.items}</legend>

        <div className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="grid grid-cols-[1fr_5rem_6rem_2.5rem] items-start gap-2"
              onKeyDown={(e) => {
                if (e.key === 'F7') {
                  e.preventDefault();
                  if (items.length > 1) removeItem(item.key);
                }
              }}
            >
              <div>
                <ItemNameInput
                  inputRef={registerItemRef(item.key, 'name')}
                  value={item.name}
                  onChange={(name) => updateItem(item.key, { name })}
                  onAccept={() => focusItem(item.key, 'quantity')}
                  onEnter={() => focusItem(item.key, 'quantity')}
                  localNames={[...sessionProductNames]}
                  placeholder={`${T.itemName} ${index + 1}`}
                  aria-label={`${T.itemName} ${index + 1}`}
                />
                {errors[`item:${item.key}:name`] && (
                  <p className="mt-1 text-xs font-bold text-red-600">
                    {errors[`item:${item.key}:name`]}
                  </p>
                )}
              </div>

              <div>
                <input
                  ref={registerItemRef(item.key, 'quantity')}
                  className="input text-center"
                  inputMode="decimal"
                  value={item.quantity}
                  aria-label={T.quantity}
                  placeholder={T.quantity}
                  onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      focusItem(item.key, 'price');
                    }
                  }}
                />
                {errors[`item:${item.key}:quantity`] && (
                  <p className="mt-1 text-xs font-bold text-red-600">
                    {errors[`item:${item.key}:quantity`]}
                  </p>
                )}
              </div>

              <div>
                <input
                  ref={registerItemRef(item.key, 'price')}
                  className="input text-center"
                  inputMode="decimal"
                  value={item.price}
                  aria-label={T.price}
                  placeholder={T.price}
                  onChange={(e) => updateItem(item.key, { price: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      // Last row: add a new one. Otherwise jump to the next name.
                      if (index === items.length - 1) {
                        addItem();
                      } else {
                        focusItem(items[index + 1].key, 'name');
                      }
                    }
                  }}
                />
                {errors[`item:${item.key}:price`] && (
                  <p className="mt-1 text-xs font-bold text-red-600">
                    {errors[`item:${item.key}:price`]}
                  </p>
                )}
              </div>

              <button
                type="button"
                className="btn-ghost h-[38px] px-2 text-red-500 disabled:opacity-30"
                onClick={() => removeItem(item.key)}
                disabled={items.length === 1}
                title={`${T.removeItem} (F7)`}
                aria-label={T.removeItem}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        {errors.items && <p className="mt-2 text-xs font-bold text-red-600">{errors.items}</p>}

        <button type="button" onClick={addItem} className="btn-ghost mt-2 text-sm">
          + {T.addItem}
        </button>
      </fieldset>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <span className="label">{T.assignTakers}</span>
          {takersLoading ? (
            <Spinner className="h-4 w-4" />
          ) : takers.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-ink-400">—</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {takers.map((taker) => {
                const selected = takerIds.includes(taker.id);
                return (
                  <button
                    key={taker.id}
                    type="button"
                    onClick={() => toggleTaker(taker.id)}
                    aria-pressed={selected}
                    className={[
                      'rounded-lg border px-3 py-1.5 text-sm font-bold transition',
                      selected
                        ? 'border-brand-500 bg-brand-500 text-white dark:border-indigo dark:bg-indigo'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-ink-900 dark:text-ink-50 dark:hover:bg-slate-700',
                    ].join(' ')}
                  >
                    {taker.username}
                  </button>
                );
              })}
            </div>
          )}
          {errors.takers && <p className="mt-1 text-xs font-bold text-red-600">{errors.takers}</p>}
        </div>

        <div>
          <label className="label" htmlFor="order-accounter">
            {T.accounter}
          </label>
          {accountersLoading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <select
              id="order-accounter"
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
          )}
          {errors.accounter && <p className="mt-1 text-xs font-bold text-red-600">{errors.accounter}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary flex-1" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {busy ? T.creating : `${T.createOrder} (Ctrl+Enter)`}
        </button>
        <button
          type="button"
          className="btn-secondary flex-1"
          disabled={busy}
          onClick={() => submit(true)}
        >
          {T.createArchived} (F3)
        </button>
      </div>
    </form>
  );
}
