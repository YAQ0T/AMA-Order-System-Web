import { useEffect, useId, useRef, useState } from 'react';

import * as ordersApi from '../api/orders';

/**
 * Item name field with server-backed suggestions.
 *
 * Behaviour ported from the Flutter _ItemsEditor: suggestions appear at two
 * characters, arrow keys move through them, Enter accepts the highlighted one
 * and jumps to quantity. Locally-created names are merged in ahead of the
 * server's so a product typed a minute ago is suggested before it has been
 * saved anywhere.
 */
export default function ItemNameInput({
  value,
  onChange,
  onAccept,
  onEnter,
  localNames = [],
  placeholder,
  inputRef,
  ...rest
}) {
  const [remote, setRemote] = useState([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  // Suggestions belong to the field being typed in. Without this, every row
  // of the edit window - which opens already filled in - fetched suggestions
  // on its own and popped its list open over the rows below it.
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const listId = useId();

  const query = (value || '').trim();

  // Derived, not stored: local matches are cheap to recompute and this keeps
  // them from going stale behind an effect.
  const local = query.length >= 2
    ? localNames
        .filter((name) => name.toLowerCase().startsWith(query.toLowerCase()) && name !== value)
        .slice(0, 6)
    : [];

  // Never suggest exactly what is already typed.
  const suggestions = query.length >= 2
    ? [...new Set([...local, ...remote])].filter((name) => name.toLowerCase() !== query.toLowerCase()).slice(0, 6)
    : [];
  const open = focused && !dismissed && suggestions.length > 0;

  useEffect(() => {
    if (!focused || query.length < 2) return undefined;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await ordersApi.suggestItems(query, controller.signal);
        if (!controller.signal.aborted) setRemote(results);
      } catch {
        /* keep whatever local matches we already have */
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, focused]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setDismissed(true);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const accept = (name) => {
    onChange(name);
    setDismissed(true);
    setRemote([]);
    setHighlighted(-1);
    onAccept?.(name);
  };

  const onKeyDown = (e) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onEnter?.();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && highlighted < suggestions.length) {
        accept(suggestions[highlighted]);
      } else {
        setDismissed(true);
        onEnter?.();
      }
    } else if (e.key === 'Escape') {
      setDismissed(true);
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        {...rest}
        ref={inputRef}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          setDismissed(false);
          setHighlighted(-1);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
      />

      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-ink-900"
        >
          {suggestions.map((name, index) => (
            <li key={name} role="option" aria-selected={index === highlighted}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(name)}
                onMouseEnter={() => setHighlighted(index)}
                className={[
                  'block w-full px-3 py-2 text-start text-sm',
                  index === highlighted
                    ? 'bg-brand-50 text-brand-800 dark:bg-indigo/20 dark:text-ink-50'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700',
                ].join(' ')}
              >
                {name}
              </button>
            </li>
          ))}
          {loading && (
            <li className="px-3 py-1 text-xs text-slate-400">…</li>
          )}
        </ul>
      )}
    </div>
  );
}
