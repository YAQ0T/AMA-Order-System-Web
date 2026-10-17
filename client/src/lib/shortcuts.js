import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts carried over from the Flutter order form:
 *
 *   Ctrl+Enter  create an active order
 *   F3          create an archived order
 *   F7          remove the focused item row
 *
 * Two of these collide with the browser: F3 opens Find in Chrome and Firefox,
 * and F7 toggles caret browsing in Firefox. We call preventDefault() to claim
 * them, which is the right trade for an internal all-day data-entry tool where
 * staff already have the muscle memory - but it is a deliberate choice, not an
 * accident. If you'd rather give them back, delete the entries from the map
 * passed by OrderForm.
 *
 * Firefox still shows a one-time "caret browsing" prompt on F7 in some versions;
 * preventDefault suppresses the toggle but not always that prompt.
 */
export function useShortcuts(bindings, { enabled = true, target = null } = {}) {
  // Held in a ref so the listener always sees the latest handlers without
  // being torn down and re-attached on every render.
  const ref = useRef(bindings);

  useEffect(() => {
    ref.current = bindings;
  }, [bindings]);

  useEffect(() => {
    if (!enabled) return undefined;
    const node = target?.current || window;

    const onKeyDown = (event) => {
      const handlers = ref.current;
      if (!handlers) return;

      const key = event.key;
      const combo = [
        event.ctrlKey || event.metaKey ? 'ctrl' : '',
        event.shiftKey ? 'shift' : '',
        event.altKey ? 'alt' : '',
        key.toLowerCase(),
      ]
        .filter(Boolean)
        .join('+');

      const handler = handlers[combo] || handlers[key];
      if (!handler) return;

      event.preventDefault();
      event.stopPropagation();
      handler(event);
    };

    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [enabled, target]);
}

/**
 * Moves focus to the next/previous focusable field inside a container.
 * Mirrors the Flutter form's chain: name -> qty -> price -> next row's name.
 */
export function focusNextField(container, current, delta = 1) {
  if (!container) return;
  const focusable = Array.from(
    container.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
  ).filter((el) => el.offsetParent !== null);

  const index = focusable.indexOf(current);
  if (index === -1) return;

  const next = focusable[index + delta];
  if (next) {
    next.focus();
    if (next.select) next.select();
  }
}
