import { describe, it, expect } from 'vitest';
import {
  normalizeDigits,
  parseNumber,
  formatQuantity,
  formatPrice,
  lineTotal,
  orderTotal,
  orderTitle,
  orderDescription,
  totalLeavesOutItems,
  hasPrices,
} from './format';

describe('normalizeDigits', () => {
  it('converts Arabic-Indic digits', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('converts Persian digits', () => {
    expect(normalizeDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('converts the Arabic decimal separator to a dot', () => {
    expect(normalizeDigits('٢٫٥')).toBe('2.5');
  });

  it('converts Arabic comma and thousands separators to a dot', () => {
    expect(normalizeDigits('2،5')).toBe('2.5');
    expect(normalizeDigits('2٬5')).toBe('2.5');
  });

  it('leaves ASCII input alone', () => {
    expect(normalizeDigits('12.75')).toBe('12.75');
  });

  it('handles null and undefined', () => {
    expect(normalizeDigits(null)).toBe('');
    expect(normalizeDigits(undefined)).toBe('');
  });
});

describe('parseNumber', () => {
  it('parses Arabic-Indic decimals', () => {
    expect(parseNumber('٢٫٥')).toBe(2.5);
    expect(parseNumber('٧٫٥')).toBe(7.5);
    expect(parseNumber('١٢')).toBe(12);
  });

  it('rejects non-numeric input rather than returning NaN', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
    expect(parseNumber('-5')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('accepts a leading dot', () => {
    expect(parseNumber('.5')).toBe(0.5);
  });
});

describe('formatQuantity', () => {
  it('drops the decimal on whole numbers', () => {
    expect(formatQuantity(3)).toBe('3');
    expect(formatQuantity(3.0)).toBe('3');
  });

  it('keeps fractional quantities', () => {
    expect(formatQuantity(1.5)).toBe('1.5');
  });
});

describe('price handling', () => {
  // Postgres DECIMAL arrives through Sequelize as a string. Every one of these
  // would silently produce nonsense if the value were used unparsed.
  it('formats a price that arrived as a string', () => {
    expect(formatPrice('12.50')).toBe('ILS 12.50');
  });

  it('shows a dash for a missing price', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice('')).toBe('—');
  });

  it('computes a line total from a string price', () => {
    expect(lineTotal({ price: '6.50', quantity: 1.5 })).toBe(9.75);
  });

  it('treats a missing price as zero rather than NaN', () => {
    expect(lineTotal({ price: null, quantity: 3 })).toBe(0);
    expect(lineTotal({})).toBe(0);
  });

  it('sums an order whose prices are all strings', () => {
    const order = {
      Items: [
        { price: '6.50', quantity: 1.5 },
        { price: '9.75', quantity: 2 },
      ],
    };
    expect(orderTotal(order)).toBe(29.25);
  });

  it('does not bill items marked unavailable', () => {
    const order = {
      Items: [
        { price: '6.50', quantity: 1.5, status: 'collected' },
        { price: '9.75', quantity: 2, status: 'unavailable' },
        { price: '2', quantity: 3, status: null },
      ],
    };
    expect(orderTotal(order)).toBe(15.75);
    expect(totalLeavesOutItems(order)).toBe(true);
    expect(totalLeavesOutItems({ Items: [{ price: '2', quantity: 1, status: 'collected' }] })).toBe(false);
    // An unavailable item without a price changes nothing, so no note for it.
    expect(totalLeavesOutItems({ Items: [{ price: null, quantity: 1, status: 'unavailable' }] })).toBe(false);
  });

  it('knows when there is no price to add up', () => {
    expect(hasPrices({ Items: [{ price: null, quantity: 2 }] })).toBe(false);
    expect(hasPrices({ Items: [{ price: '1', quantity: 2, status: 'unavailable' }] })).toBe(true);
    expect(hasPrices({})).toBe(false);
  });
});

describe('orderTitle', () => {
  it('uses the title when present', () => {
    expect(orderTitle({ id: 5, title: 'زبون' })).toBe('زبون');
  });

  it('falls back to the order number', () => {
    expect(orderTitle({ id: 5, title: '' })).toBe('طلب #5');
    expect(orderTitle({ id: 5, title: null })).toBe('طلب #5');
  });
});

describe('orderDescription', () => {
  it('returns the description as typed', () => {
    expect(orderDescription({ description: '  توصيل بعد الظهر ' })).toBe('توصيل بعد الظهر');
  });

  it('treats the old English filler (and nothing) as no description', () => {
    expect(orderDescription({ description: 'Order with 3 items' })).toBe('');
    expect(orderDescription({ description: 'Order with 1 items' })).toBe('');
    expect(orderDescription({ description: 'New Order' })).toBe('');
    expect(orderDescription({ description: null })).toBe('');
    expect(orderDescription(undefined)).toBe('');
  });

  it('keeps real text that merely starts the same way', () => {
    expect(orderDescription({ description: 'Order with 3 items - deliver Sunday' })).toBe('Order with 3 items - deliver Sunday');
  });
});
