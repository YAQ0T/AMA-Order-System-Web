import { describe, it, expect } from 'vitest';
import { buildReport } from './report';

const order = (id, createdAt, items, takers = []) => ({
  id,
  title: `زبون ${id}`,
  createdAt,
  AssignedTakers: takers.map((username, i) => ({ id: i + 1, username })),
  Items: items.map(([name, quantity, status], i) => ({ id: i + 1, name, quantity, status })),
});

describe('buildReport', () => {
  const orders = [
    order(1, '2026-03-10T10:00:00Z', [['طحينة', 2, 'collected'], ['سكر', 3, null]], ['taker1']),
    order(2, '2026-03-12T10:00:00Z', [['طحينة', 1.5, null], ['سكر', 1, 'unavailable']], ['taker1', 'taker2']),
    order(3, '2026-01-01T10:00:00Z', [['شاي', 10, 'collected']], ['taker2']),
  ];

  const report = buildReport(orders, new Date('2026-03-01'), new Date('2026-03-31'));

  it('filters to the requested date range', () => {
    expect(report.orderCount).toBe(2);
    expect(report.orders.map((o) => o.id)).toEqual([1, 2]);
  });

  it('counts an item with no status as sold', () => {
    // Only 'unavailable' is excluded; unset means it went out.
    expect(report.productsSold.find(([n]) => n === 'سكر')?.[1]).toBe(3);
  });

  it('excludes unavailable items from the sold totals', () => {
    expect(report.unavailableProducts.find(([n]) => n === 'سكر')?.[1]).toBe(1);
    expect(report.totalSoldQuantity).toBe(2 + 3 + 1.5);
  });

  it('sums fractional quantities correctly', () => {
    expect(report.productsSold.find(([n]) => n === 'طحينة')?.[1]).toBe(3.5);
  });

  it('counts each taker once per order', () => {
    const map = Object.fromEntries(report.takerAssignments);
    expect(map.taker1).toBe(2);
    expect(map.taker2).toBe(1);
  });

  it('counts orders per customer', () => {
    expect(report.customerOrders).toHaveLength(2);
  });

  it('sorts results by quantity, descending', () => {
    const values = report.productsSold.map(([, v]) => v);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it('includes orders on the boundary days', () => {
    const boundary = buildReport(orders, new Date('2026-03-10'), new Date('2026-03-12'));
    expect(boundary.orderCount).toBe(2);
  });

  it('returns empty aggregates for a range with no orders', () => {
    const empty = buildReport(orders, new Date('2025-01-01'), new Date('2025-01-31'));
    expect(empty.orderCount).toBe(0);
    expect(empty.totalSoldQuantity).toBe(0);
    expect(empty.productsSold).toEqual([]);
  });

  it('ignores orders with an unparseable date instead of throwing', () => {
    const bad = buildReport([order(9, 'not-a-date', [['x', 1, null]])], new Date('2026-01-01'), new Date('2026-12-31'));
    expect(bad.orderCount).toBe(0);
  });
});
