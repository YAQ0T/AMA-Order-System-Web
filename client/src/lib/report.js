import { startOfDay, endOfDay, orderTitle } from './format';

/**
 * Report aggregation, ported from lib/src/utils/order_report.dart.
 *
 * Runs client-side over every order in range, because the server has no
 * aggregate endpoint and caps pages at 20 rows. That is fine for hundreds of
 * orders and gets slow in the thousands - see the README for what a server-side
 * version would look like.
 */
export function buildReport(orders, from, to) {
  const start = startOfDay(from);
  const end = endOfDay(to);

  const filtered = orders
    .filter((order) => {
      const created = new Date(order.createdAt);
      if (Number.isNaN(created.getTime())) return false;
      return created >= start && created <= end;
    })
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const productsSold = new Map();
  const unavailableProducts = new Map();
  const takerAssignments = new Map();
  const customerOrders = new Map();
  let totalSoldQuantity = 0;

  const bump = (map, key, amount) => map.set(key, (map.get(key) || 0) + amount);

  for (const order of filtered) {
    const customer = orderTitle(order).trim();
    if (customer) bump(customerOrders, customer, 1);

    // A taker assigned twice to the same order still counts once.
    const takerNames = new Set(
      (order.AssignedTakers || []).map((t) => (t.username || '').trim()).filter(Boolean)
    );
    for (const name of takerNames) bump(takerAssignments, name, 1);

    for (const item of order.Items || []) {
      const name = (item.name || '').trim();
      if (!name) continue;
      const qty = Number(item.quantity) || 0;
      const status = (item.status || '').toLowerCase().trim();

      if (status === 'unavailable') {
        bump(unavailableProducts, name, qty);
      } else {
        totalSoldQuantity += qty;
        bump(productsSold, name, qty);
      }
    }
  }

  const toSortedEntries = (map) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'));

  return {
    from: start,
    to: end,
    orders: filtered,
    orderCount: filtered.length,
    totalSoldQuantity,
    productsSold: toSortedEntries(productsSold),
    unavailableProducts: toSortedEntries(unavailableProducts),
    takerAssignments: toSortedEntries(takerAssignments),
    customerOrders: toSortedEntries(customerOrders),
  };
}
