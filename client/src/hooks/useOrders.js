import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as ordersApi from '../api/orders';
import { useAuth } from '../store/auth';

/**
 * Query keys are scoped by role, because each role hits a different endpoint
 * and gets a different shape back (takers don't receive item prices).
 */
export const orderKeys = {
  all: ['orders'],
  list: (role, params) => ['orders', role, params],
};

export function useOrdersQuery({ status = 'active', search = '', city = '', limit, offset = 0, includeHistory = true, enabled = true } = {}) {
  const role = useAuth((s) => s.user?.role);
  const params = { status, search, city, limit, offset, includeHistory };

  return useQuery({
    queryKey: orderKeys.list(role, params),
    queryFn: ({ signal }) => ordersApi.fetchOrders({ role, ...params, signal }),
    enabled: Boolean(role) && enabled,
    placeholderData: (previous) => previous, // keep rows on screen while refetching
  });
}

/** Invalidate every order list regardless of role/filter. */
export function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: orderKeys.all });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ordersApi.createOrder,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => ordersApi.updateOrder(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

export function useDeleteOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ordersApi.deleteOrder,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orderKeys.all }),
  });
}

/**
 * Replace one order everywhere it appears in the cache.
 *
 * Writing the server's response straight into the cache beats invalidating and
 * refetching: there is no window where a queued write can read a stale copy,
 * and no extra round-trip per tap.
 */
function patchCachedOrder(queryClient, updated) {
  if (!updated) return;
  queryClient.setQueriesData({ queryKey: orderKeys.all }, (data) => {
    if (!data?.orders?.some((o) => o.id === updated.id)) return data;
    return {
      ...data,
      orders: data.orders.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)),
    };
  });
}

/** Apply an arbitrary change to one cached order (used for optimistic updates). */
function updateCachedOrder(queryClient, orderId, updater) {
  queryClient.setQueriesData({ queryKey: orderKeys.all }, (data) => {
    if (!data?.orders?.some((o) => o.id === orderId)) return data;
    return {
      ...data,
      orders: data.orders.map((o) => (o.id === orderId ? updater(o) : o)),
    };
  });
}

/**
 * Item status toggling.
 *
 * Each tap sends ONE item's change to PATCH /api/orders/:id/items/status,
 * which updates that single row server-side. It used to rebuild and PUT the
 * whole item list, and that is what lost work: two takers on the same order
 * each sent the list as they last saw it, so the second write undid the first.
 * A single-row update cannot touch an item it was not asked about.
 *
 * Items are identified by NAME, never id. PUT /api/orders/:id rebuilds items
 * with destroy + bulkCreate, so ids rotate on every order edit and a held id
 * goes stale. Names are what the server matches on and are unique per order.
 *
 * Taps are still queued per order. Two taps on the SAME item (tick, then
 * untick) must land in the order they were made, and HTTP requests do not
 * guarantee that on their own.
 */
const itemQueues = new Map();

export function useUpdateItemStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ order, itemName, status }) => {
      const previous = itemQueues.get(order.id) ?? Promise.resolve();

      // Optimistic: show the tick immediately. Takers work down a list fast and
      // should never be waiting on a round-trip to see their own tap land.
      updateCachedOrder(queryClient, order.id, (o) => ({
        ...o,
        Items: (o.Items || []).map((item) =>
          item.name === itemName ? { ...item, status } : item
        ),
      }));

      const next = previous
        .catch(() => {})
        .then(async () => {
          const result = await ordersApi.setItemStatus(order.id, itemName, status);
          patchCachedOrder(queryClient, result);
          return result;
        });

      itemQueues.set(order.id, next);

      next
        .catch(() => {
          // A failed write leaves the optimistic tick on screen, so pull the
          // real state back from the server.
          queryClient.invalidateQueries({ queryKey: orderKeys.all });
        })
        .finally(() => {
          if (itemQueues.get(order.id) === next) itemQueues.delete(order.id);
        });

      return next;
    },
  });
}

export function useItemSuggestions() {
  return useMutation({
    mutationFn: ({ query, signal }) => ordersApi.suggestItems(query, signal),
  });
}
