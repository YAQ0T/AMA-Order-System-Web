import { describe, it, expect } from 'vitest';
import { buildPrintDocument } from './printOrders';

const order = {
  id: 1024,
  title: 'زبون تجريبي',
  description: 'ملاحظة',
  status: 'in-progress',
  city: 'نابلس',
  createdAt: '2026-03-10T08:30:00Z',
  Maker: { id: 1, username: 'maker1' },
  Accounter: { id: 2, username: 'acc1' },
  AssignedTakers: [{ id: 3, username: 'taker1' }],
  Items: [
    { id: 1, name: 'طحينة', quantity: 1.5, price: '6.50', status: 'collected' },
    { id: 2, name: 'سكر', quantity: 2, price: '9.75', status: 'unavailable' },
  ],
  History: [],
};

describe('buildPrintDocument', () => {
  const html = buildPrintDocument([order], { showPrices: true });

  it('renders an RTL Arabic document', () => {
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });

  it('isolates numbers so bidi cannot reorder them', () => {
    // Without dir="ltr", "#1024" renders as "1024#" inside an RTL run.
    expect(html).toContain('<span dir="ltr">#1024</span>');
  });

  it('uses the Arabic label for in-progress', () => {
    // The DB enum is 'in-progress' with a hyphen. The Flutter PDF builder and
    // the old React print component both switch on 'in_progress', so this case
    // never matched and printed the raw English string.
    expect(html).toContain('قيد التنفيذ');
    expect(html).not.toContain('in-progress');
  });

  it('computes line and grand totals from string prices', () => {
    expect(html).toContain('9.75');    // 6.50 x 1.5
    expect(html).toContain('19.50');   // 9.75 x 2
    expect(html).toContain('29.25');   // grand total
  });

  it('marks unavailable and collected rows distinctly', () => {
    expect(html).toContain('row-unavailable');
    expect(html).toContain('row-collected');
  });

  it('embeds the self-hosted Arabic font', () => {
    expect(html).toContain('NotoSansArabic-Regular.ttf');
  });

  it('escapes HTML in user-supplied text', () => {
    const nasty = buildPrintDocument(
      [{ ...order, title: '<script>alert(1)</script>', Items: [] }],
      { showPrices: true }
    );
    expect(nasty).not.toContain('<script>alert(1)</script>');
    expect(nasty).toContain('&lt;script&gt;');
  });

  it('omits price columns when showPrices is false (taker copy)', () => {
    const takerCopy = buildPrintDocument([order], { showPrices: false });
    expect(takerCopy).not.toContain('السعر');
    expect(takerCopy).toContain('طحينة');
  });

  it('page-breaks between orders but not after the last one', () => {
    const two = buildPrintDocument([order, { ...order, id: 1025 }], { showPrices: true });
    expect(two.match(/page-break-after/g)).toHaveLength(1);
  });

  it('handles an order with no items without crashing', () => {
    expect(() => buildPrintDocument([{ ...order, Items: [] }], { showPrices: true })).not.toThrow();
  });
});
