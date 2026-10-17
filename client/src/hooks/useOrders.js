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
 * Item status toggling, serialised per order.
 *
 * Two things make this harder than it looks, both of them server behaviour:
 *
 * 1. Every PUT rebuilds the order's whole item list, so two updates racing each
 *    other clobber one another - the second carries a snapshot taken before the
 *    first landed and one tick silently disappears.
 *
 * 2. The rebuild is `OrderItem.destroy` + `bulkCreate` (routes/orders.js), so
 *    **every item gets a brand-new id on every save**. Any id the browser is
 *    holding is dead the moment anything in that order is written. Matching
 *    items by id therefore fails intermittently: a queued tap finds no match
 *    and is dropped, or falls back to a stale snapshot and wipes an earlier
 *    tick. That is the "marking a second item clears the first" bug.
 *
 * So we key by **name**, which is what the server itself keys on
 * (statusProvidedByName, existingItemsStatus) and which `sanitizeItems`
 * guarantees is unique within an order.
 *
 * The queue chains on the server's own response rather than re-reading the
 * cache, so each link builds on what actually persisted.
 */
const itemQueues = new Map();

export function useUpdateItemStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ order, itemName, status, extra = {} }) => {
      const queued = itemQueues.get(order.id);
      const previous = queued?.promise ?? Promise.resolve(null);

      // Optimistic: show the tick immediately. Takers work down a list fast and
      // should never be waiting on a round-trip to see their own tap land.
      updateCachedOrder(queryClient, order.id, (o) => ({
        ...o,
        Items: (o.Items || []).map((item) =>
          item.name === itemName ? { ...item, status } : item
        ),
      }));

      const next = previous
        .catch(() => null)
        .then(async (prevResult) => {
          // Build on whatever the previous write in this queue actually
          // returned; only fall back to the cache when this is the first link.
          const base =
            prevResult ?? findCachedOrder(queryClient, order.id) ?? order;

          const items = ordersApi.itemsPayload(
            (base.Items || []).map((item) =>
              item.name === itemName ? { ...item, status } : item
            )
          );

          const result = await ordersApi.updateOrder(base.id, { items, ...extra });
          patchCachedOrder(queryClient, result);
          return result;
        });

      itemQueues.set(order.id, { promise: next });

      next
        .catch(() => {
          // A failed write leaves the optimistic tick on screen, so pull the
          // real state back from the server.
          queryClient.invalidateQueries({ queryKey: orderKeys.all });
        })
        .finally(() => {
          if (itemQueues.get(order.id)?.promise === next) itemQueues.delete(order.id);
        });

      return next;
    },
  });
}

function findCachedOrder(queryClient, orderId) {
  const entries = queryClient.getQueriesData({ queryKey: orderKeys.all });
  for (const [, data] of entries) {
    const found = data?.orders?.find((o) => o.id === orderId);
    if (found) return found;
  }
  return null;
}

export function useItemSuggestions() {
  return useMutation({
    mutationFn: ({ query, signal }) => ordersApi.suggestItems(query, signal),
  });
}
