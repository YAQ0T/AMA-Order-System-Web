import { describe, it, expect } from 'vitest';
import { orderSchema, orderItemSchema, orderListSchema, userSchema } from './schemas';
import { itemsPayload } from './orders';

describe('orderItemSchema', () => {
  it('coerces a DECIMAL price that arrived as a string', () => {
    const item = orderItemSchema.parse({ id: 1, name: 'طحينة', quantity: '1.5', price: '12.50', status: null });
    expect(item.price).toBe(12.5);
    expect(typeof item.price).toBe('number');
    expect(item.quantity).toBe(1.5);
  });

  it('accepts an item with no price field at all (taker payload)', () => {
    const item = orderItemSchema.parse({ id: 1, name: 'طحينة', quantity: 2, status: 'collected' });
    expect(item.price).toBeUndefined();
    expect(item.status).toBe('collected');
  });

  it('normalises an empty-string price to null', () => {
    expect(orderItemSchema.parse({ id: 1, name: 'x', quantity: 1, price: '' }).price).toBeNull();
  });

  it('defaults a missing status to null', () => {
    expect(orderItemSchema.parse({ id: 1, name: 'x', quantity: 1 }).status).toBeNull();
  });
});

describe('orderSchema', () => {
  it('defaults the relation arrays so the UI never maps over undefined', () => {
    const order = orderSchema.parse({ id: 1, status: 'pending' });
    expect(order.Items).toEqual([]);
    expect(order.AssignedTakers).toEqual([]);
    expect(order.History).toEqual([]);
  });

  it('keeps the hyphenated in-progress status verbatim', () => {
    expect(orderSchema.parse({ id: 1, status: 'in-progress' }).status).toBe('in-progress');
  });
});

describe('orderListSchema', () => {
  it('accepts the { orders, pagination } shape', () => {
    const out = orderListSchema.parse({
      orders: [{ id: 1, status: 'pending' }],
      pagination: { total: 1, limit: 20, offset: 0 },
    });
    expect(out.orders).toHaveLength(1);
    expect(out.pagination.total).toBe(1);
  });

  it('accepts a bare array from the legacy endpoints', () => {
    const out = orderListSchema.parse([{ id: 1, status: 'pending' }]);
    expect(out.orders).toHaveLength(1);
    expect(out.pagination.total).toBe(1);
  });
});

describe('userSchema', () => {
  it('accepts either isApproved or the legacy approved flag', () => {
    expect(userSchema.parse({ id: 1, username: 'a', role: 'maker', isApproved: true }).isApproved).toBe(true);
    expect(userSchema.parse({ id: 1, username: 'a', role: 'maker', approved: true }).isApproved).toBe(true);
    expect(userSchema.parse({ id: 1, username: 'a', role: 'maker' }).isApproved).toBe(false);
  });
});

describe('itemsPayload', () => {
  // Regression guard for the "marking a second item clears the first" bug.
  // Item ids rotate on every save (destroy + bulkCreate in routes/orders.js),
  // so a client-held id is routinely stale. Sending it can only mislead the
  // server's taker price lookup.
  it('never sends the rotating item id', () => {
    const payload = itemsPayload([{ id: 42, name: 'طحينة', quantity: 2, price: 5, status: 'collected' }]);
    expect(payload[0]).not.toHaveProperty('id');
  });

  // Regression guard for "two takers wipe each other's ticks". A structural
  // edit (add item, change quantity) must NOT carry statuses: with the key
  // absent the server keeps each item's live status, so a tick another taker
  // made in the meantime survives. Sending our copy would overwrite it.
  it('never sends status, so the server keeps the live value', () => {
    const payload = itemsPayload([
      { name: 'a', quantity: 1, status: 'collected' },
      { name: 'b', quantity: 2, status: null },
    ]);
    for (const item of payload) {
      expect(item).not.toHaveProperty('status');
    }
  });

  it('sends null rather than undefined for a missing price', () => {
    expect(itemsPayload([{ name: 'x', quantity: 1 }])[0].price).toBeNull();
  });

  it('preserves every item, since omitting one deletes it server-side', () => {
    const items = [
      { name: 'a', quantity: 1 },
      { name: 'b', quantity: 2.5 },
      { name: 'c', quantity: 3 },
    ];
    const payload = itemsPayload(items);
    expect(payload).toHaveLength(3);
    expect(payload.map((i) => [i.name, i.quantity])).toEqual([['a', 1], ['b', 2.5], ['c', 3]]);
  });
});
