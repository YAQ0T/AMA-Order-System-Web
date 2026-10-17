import { useEffect, useState } from 'react';

import { T, STATUS_FILTER_LABELS, CITIES } from '../lib/labels';

/**
 * Search is debounced so typing doesn't fire a request per keystroke - the
 * server does an ILIKE across title/description/city for every one.
 */
export default function OrderFilters({
  status,
  onStatusChange,
  allowedStatuses,
  statusEnabled = true,
  search,
  onSearchChange,
  city,
  onCityChange,
  showCity = false,
}) {
  const [draft, setDraft] = useState(search || '');
  const [lastSearch, setLastSearch] = useState(search);

  // Adjusting state during render when a prop changes - the pattern React
  // recommends over a setState-in-effect. Keeps the box in sync when a parent
  // clears the search (e.g. switching tabs).
  if (search !== lastSearch) {
    setLastSearch(search);
    setDraft(search || '');
  }

  useEffect(() => {
    if (draft === (search || '')) return undefined;
    const timer = setTimeout(() => onSearchChange?.(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, search, onSearchChange]);

  return (
    <div className="card mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label className="label" htmlFor="order-search">
          {T.search}
        </label>
        <input
          id="order-search"
          type="search"
          className="input"
          placeholder={T.searchPlaceholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>

      {statusEnabled && allowedStatuses?.length > 1 && (
        <div className="sm:w-52">
          <label className="label" htmlFor="order-status">
            {T.filterByStatus}
          </label>
          <select
            id="order-status"
            className="input"
            value={status}
            onChange={(e) => onStatusChange?.(e.target.value)}
          >
            {allowedStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_FILTER_LABELS[s] || s}
              </option>
            ))}
          </select>
        </div>
      )}

      {showCity && (
        <div className="sm:w-44">
          <label className="label" htmlFor="order-city">
            {T.city}
          </label>
          <select
            id="order-city"
            className="input"
            value={city || ''}
            onChange={(e) => onCityChange?.(e.target.value)}
          >
            <option value="">{T.allCities}</option>
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
