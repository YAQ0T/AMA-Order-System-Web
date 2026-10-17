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

export async function sendBulkEmail(orderIds, takerIds) {
  return api.post('/api/orders/bulk-email', { orderIds, takerIds });
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

export async function updateItemStatus(itemId, status) {
  return api.patch(`/api/items/${itemId}/status`, { status });
}

/**
 * Build the `items` array the PUT /api/orders/:id endpoint expects.
 *
 * Always send the FULL item list with every field present: the server rebuilds
 * the order's items from exactly what arrives, and it distinguishes a missing
 * `status` key from an explicit null (statusProvidedByName in routes/orders.js).
 * Omit an item here and it is deleted.
 *
 * `id` is deliberately NOT sent. The server drops it anyway (sanitizeItems
 * returns only name/quantity/price/status) and matches rows by name. It is used
 * for one thing - restoring prices on a taker's write - and that lookup already
 * falls back to name. Since every save rotates item ids via destroy +
 * bulkCreate, a client-held id is routinely stale, so sending it can only
 * mislead.
 */
export function itemsPayload(items) {
  return (items || []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    price: item.price ?? null,
    status: item.status ?? null,
  }));
}
