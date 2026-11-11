import { api } from './client';
import { orderSchema, orderListSchema, parseOr } from './schemas';
import { z } from 'zod';

/**
 * Each role has its own list endpoint, added in the server's
 * "make individual api for each role" change. The generic /api/orders is the
 * fallback. Using the right one matters: the server applies role-specific
 * filtering (takers only see assigned, non-completed orders; accounters only
 * see their own completed/entered_erp ones).
 */
const ROLE_ENDPOINTS = {
  maker: '/api/orders/maker',
  taker: '/api/orders/taker',
  admin: '/api/orders/admin',
  accounter: '/api/orders/accounter',
};

export function endpointForRole(role) {
  return ROLE_ENDPOINTS[role] || '/api/orders';
}

/**
 * The server caps `limit` at 20 (order_helpers.js getPaginationParams), so
 * asking for more is silently ignored.
 */
export const MAX_PAGE_SIZE = 20;

export async function fetchOrders({
  role,
  status,
  search,
  city,
  limit = MAX_PAGE_SIZE,
  offset = 0,
  includeHistory = true,
  signal,
} = {}) {
  const data = await api.get(
    endpointForRole(role),
    {
      // 'active' is a real server-side filter (pending + in-progress);
      // 'all' means send nothing so the server does not default to active.
      status: status === 'all' ? 'all' : status,
      search,
      city,
      limit,
      offset,
      includeHistory: includeHistory ? 'true' : 'false',
    },
    { signal }
  );

  return parseOr(orderListSchema, data, { orders: [], pagination: { total: 0, limit, offset } }, 'orders');
}

/**
 * Orders left open to any taker (pending, nobody assigned), oldest first.
 * Takers only. They come without prices, like every taker list.
 */
export async function fetchOpenOrders({ search, limit = MAX_PAGE_SIZE, offset = 0, signal } = {}) {
  const data = await api.get('/api/orders/open', { search, limit, offset }, { signal });
  return parseOr(orderListSchema, data, { orders: [], pagination: { total: 0, limit, offset } }, 'openOrders');
}

/**
 * Take an open order. First come, first served: if another taker got there
 * first the server answers 409, which reaches the caller as an ApiError with
 * status 409.
 */
export async function claimOrder(id) {
  const data = await api.post(`/api/orders/${id}/claim`);
  return parseOr(orderSchema, data, null, 'claimOrder');
}

/** An order nobody is assigned to yet, waiting for any taker to take it. */
export const isOpenOrder = (order) =>
  order?.status === 'pending' && (order.AssignedTakers || []).length === 0;

/**
 * Completed orders no accountant has taken yet (accountants and the admin).
 * Urgent first, then the longest-waiting first.
 */
export async function fetchAvailableForAccounting({ search, limit = MAX_PAGE_SIZE, offset = 0, signal } = {}) {
  const data = await api.get('/api/orders/accounter/available', { search, limit, offset }, { signal });
  return parseOr(orderListSchema, data, { orders: [], pagination: { total: 0, limit, offset } }, 'availableForAccounting');
}

/** An accountant takes a completed order. A 409 means another accountant was first. */
export async function claimForAccounting(id) {
  const data = await api.post(`/api/orders/${id}/accounting-claim`);
  return parseOr(orderSchema, data, null, 'claimForAccounting');
}

/** Completed and not taken by an accountant yet. */
export const awaitsAccountant = (order) => order?.status === 'completed' && !order.accounterId;

/** A taker brings other takers in to help with an order they are on. */
export async function addHelpers(orderId, takerIds) {
  const data = await api.post(`/api/orders/${orderId}/helpers`, { takerIds });
  return parseOr(orderSchema, data, null, 'addHelpers');
}

/** Pages through everything for reports. Used sparingly - see README. */
export async function fetchAllOrders({ role, status = 'all', signal, onProgress } = {}) {
  const all = [];
  let offset = 0;

  for (;;) {
    const { orders } = await fetchOrders({
      role,
      status,
      limit: MAX_PAGE_SIZE,
      offset,
      includeHistory: false,
      signal,
    });
    if (!orders.length) break;
    all.push(...orders);
    onProgress?.(all.length);
    if (orders.length < MAX_PAGE_SIZE) break;
    offset += MAX_PAGE_SIZE;
    // Safety valve so a server-side paging bug can't spin forever.
    if (offset > 20000) break;
  }

  return all;
}

export async function createOrder(payload) {
  const data = await api.post('/api/orders', payload);
  return parseOr(orderSchema, data, null, 'createOrder');
}

export async function updateOrder(id, payload) {
  const data = await api.put(`/api/orders/${id}`, payload);
  return parseOr(orderSchema, data, null, 'updateOrder');
}

export async function deleteOrder(id) {
  return api.delete(`/api/orders/${id}`);
}

const suggestionSchema = z.array(z.string());

export async function suggestItems(q, signal) {
  if (!q || q.trim().length < 2) return [];
  const data = await api.get('/api/items/suggestions', { q: q.trim() }, { signal });
  return parseOr(suggestionSchema, data, [], 'itemSuggestions');
}

export async function suggestTitles(q, signal) {
  if (!q || q.trim().length < 2) return [];
  const data = await api.get('/api/orders/suggestions', { q: q.trim() }, { signal });
  return parseOr(suggestionSchema, data, [], 'titleSuggestions');
}

/**
 * Set ONE item's status. The server updates that single row, so two takers
 * ticking different items in the same order cannot undo each other.
 * Items are addressed by name: ids rotate whenever the order is saved via PUT.
 */
export async function setItemStatus(orderId, name, status) {
  const data = await api.patch(`/api/orders/${orderId}/items/status`, { name, status: status ?? null });
  return parseOr(orderSchema, data, null, 'setItemStatus');
}

/**
 * Change ONE item's quantity, and nothing else. Takers used to save a quantity
 * by sending the whole item list as their screen last showed it - and an old
 * screen sent old quantities back over newer ones.
 */
export async function setItemQuantity(orderId, name, quantity) {
  const data = await api.patch(`/api/orders/${orderId}/items/quantity`, { name, quantity });
  return parseOr(orderSchema, data, null, 'setItemQuantity');
}

/** Add ONE item to an order (takers add it without a price). */
export async function addOrderItem(orderId, { name, quantity }) {
  const data = await api.post(`/api/orders/${orderId}/items`, { name, quantity });
  return parseOr(orderSchema, data, null, 'addOrderItem');
}

/**
 * Build the `items` array for PUT /api/orders/:id - used by the maker's edit
 * window for STRUCTURAL edits (adding, removing, re-quantifying or re-pricing
 * items). Send the FULL list, together with `baseItems`: the items as the
 * window first showed them. The server then applies only what the maker
 * changed, and keeps whatever takers changed in the meantime
 * (mergeItemEdits in server/routes/order_helpers.js). Without `baseItems` the
 * list replaces the order's items as it is, so an item missing here is deleted.
 *
 * `status` is deliberately NOT sent. When the key is absent the server keeps
 * each item's current status, read after it locks the order row
 * (statusProvidedByName in routes/orders.js). That matters because a taker may
 * have ticked an item while this edit was being prepared; sending our copy of
 * the statuses would silently overwrite their tick. Status changes go through
 * setItemStatus instead. (OrderEditModal is the one exception: a RENAMED item is
 * new to the server, so it carries its status across explicitly.)
 *
 * `id` is deliberately NOT sent either. The server drops it (sanitizeItems
 * keeps only name/quantity/price/status) and every PUT rotates ids anyway, so a
 * client-held id is routinely stale.
 */
export function itemsPayload(items) {
  return (items || []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    price: item.price ?? null,
  }));
}
