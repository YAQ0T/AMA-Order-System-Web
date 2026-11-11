import { statusLabel, T, CURRENCY } from '../lib/labels';
import {
  formatDateTime,
  formatQuantity,
  lineTotal,
  orderTitle,
  orderDescription,
  orderTotal,
  totalLeavesOutItems,
  hasPrices,
} from '../lib/format';

/**
 * Printing is done by the browser, not by a JS PDF library.
 *
 * The Flutter app builds a PDF with the `pdf` package and embedded Noto fonts.
 * On the web that is the wrong trade: jsPDF and pdfmake do not do Arabic
 * shaping, so ligatures come out broken and letters render in isolated forms.
 * The browser's own layout engine shapes Arabic correctly, handles RTL, and
 * Ctrl+P -> "Save as PDF" still produces a real PDF file.
 *
 * We render into a hidden same-origin iframe rather than hiding the rest of the
 * page with CSS, so the app's own styles can never leak into the printout.
 */

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (n) => (Number(n) || 0).toFixed(2);

function itemRows(order, showPrices) {
  const items = order.Items || [];
  if (!items.length) {
    return `<tr><td colspan="${showPrices ? 6 : 4}" class="empty">—</td></tr>`;
  }

  return items
    .map((item, index) => {
      const unavailable = item.status === 'unavailable';
      const collected = item.status === 'collected';
      const rowClass = unavailable ? 'row-unavailable' : collected ? 'row-collected' : '';
      const statusText = unavailable ? 'غير متوفر' : collected ? 'تم التجهيز' : '';

      return `
        <tr class="${rowClass}">
          <td class="num"><span dir="ltr">${index + 1}</span></td>
          <td class="name">${escapeHtml(item.name)}</td>
          <td class="num"><span dir="ltr">${escapeHtml(formatQuantity(item.quantity))}</span></td>
          ${showPrices ? `<td class="num"><span dir="ltr">${item.price == null ? '—' : money(item.price)}</span></td>` : ''}
          ${showPrices ? `<td class="num line-total"><span dir="ltr">${money(lineTotal(item))}</span></td>` : ''}
          <td class="status">${statusText}</td>
        </tr>`;
    })
    .join('');
}

function orderPage(order, { showPrices, isLast }) {
  // Unavailable items did not go out: not in the total (same as on screen).
  const total = orderTotal(order);
  const takers = (order.AssignedTakers || []).map((t) => t.username).join('، ');

  return `
    <section class="page" ${isLast ? '' : 'style="page-break-after: always;"'}>
      <header class="head">
        <h1>${escapeHtml(T.appName)}</h1>
        ${order.isUrgent || order.isOnline
          ? `<div class="marks">${order.isUrgent ? `<span class="mark urgent">${escapeHtml(T.urgentOrderLong)}</span>` : ''}${order.isOnline ? `<span class="mark online">${escapeHtml(T.onlineOrder)}</span>` : ''}</div>`
          : ''}
      </header>

      <div class="meta">
        <div><b>${escapeHtml(T.orderNumber)}:</b> <span dir="ltr">#${escapeHtml(order.id)}</span></div>
        <div><b>${escapeHtml(T.sentAt)}:</b> <span dir="ltr">${escapeHtml(formatDateTime(order.createdAt))}</span></div>
        <div><b>${escapeHtml(T.city)}:</b> ${escapeHtml(order.city || '—')}</div>
        <div><b>${escapeHtml(T.status)}:</b> ${escapeHtml(statusLabel(order.status))}</div>
        <div class="wide"><b>${escapeHtml(T.customerName)}:</b> ${escapeHtml(orderTitle(order))}</div>
        ${order.Maker ? `<div><b>${escapeHtml(T.maker)}:</b> ${escapeHtml(order.Maker.username)}</div>` : ''}
        ${takers ? `<div><b>${escapeHtml(T.takers)}:</b> ${escapeHtml(takers)}</div>` : ''}
        ${order.Accounter ? `<div><b>${escapeHtml(T.accounter)}:</b> ${escapeHtml(order.Accounter.username)}</div>` : ''}
        ${orderDescription(order) ? `<div class="wide"><b>${escapeHtml(T.description)}:</b> ${escapeHtml(orderDescription(order))}</div>` : ''}
      </div>

      <table class="items">
        <thead>
          <tr>
            <th class="num">#</th>
            <th class="name">${escapeHtml(T.itemName)}</th>
            <th class="num">${escapeHtml(T.quantity)}</th>
            ${showPrices ? `<th class="num">${escapeHtml(T.price)}</th>` : ''}
            ${showPrices ? `<th class="num">${escapeHtml(T.total)}</th>` : ''}
            <th class="status">${escapeHtml(T.status)}</th>
          </tr>
        </thead>
        <tbody>${itemRows(order, showPrices)}</tbody>
        ${
          showPrices && hasPrices(order)
            ? `<tfoot>
                 <tr>
                   <td colspan="${3}" class="total-label">${escapeHtml(T.grandTotal)}</td>
                   <td colspan="2" class="num total-value"><span dir="ltr">${CURRENCY} ${money(total)}</span>${
                     totalLeavesOutItems(order)
                       ? `<div class="total-note">${escapeHtml(T.totalLeavesOutUnavailable)}</div>`
                       : ''
                   }</td>
                   <td></td>
                 </tr>
               </tfoot>`
            : ''
        }
      </table>

      <footer class="foot">
        <span dir="ltr">${escapeHtml(formatDateTime(new Date()))}</span>
      </footer>
    </section>`;
}

const PRINT_CSS = `
  @page { size: A4; margin: 12mm; }

  @font-face {
    font-family: 'Noto Sans Arabic';
    src: url('/fonts/NotoSansArabic-Regular.ttf') format('truetype');
    font-weight: 100 900;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    font-family: 'Noto Sans Arabic', system-ui, 'Segoe UI', sans-serif;
    color: #000;
    background: #fff;
    font-size: 12px;
  }

  /* Numbers, IDs and dates stay LTR inside the RTL page. */
  [dir='ltr'] { unicode-bidi: isolate; display: inline-block; }

  .page { padding: 0; }

  .head {
    text-align: center;
    border-bottom: 2px solid #333;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  .head h1 { margin: 0; font-size: 20px; }
  /* Bordered as well as coloured, so the marks survive black-and-white printing. */
  .marks { display: flex; gap: 6px; }
  .mark { border: 2px solid; border-radius: 6px; padding: 2px 10px; font-size: 13px; font-weight: 700; }
  .mark.urgent { color: #b91c1c; border-color: #b91c1c; }
  .mark.online { color: #0369a1; border-color: #0369a1; }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    background: #f4f4f4;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .meta > div { font-size: 12px; }
  .meta .wide { flex-basis: 100%; }
  .meta b { color: #444; }

  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 10px;
  }
  table.items th,
  table.items td {
    border: 1px solid #bbb;
    padding: 5px 7px;
    text-align: right;
    vertical-align: top;
  }
  table.items thead th {
    background: #e8e8e8;
    font-weight: 700;
    font-size: 11px;
  }
  table.items .num { text-align: center; width: 60px; }
  table.items th.num:first-child, table.items td.num:first-child { width: 32px; }
  table.items .name { text-align: right; }
  table.items .status { width: 80px; text-align: center; font-size: 11px; }
  table.items .empty { text-align: center; color: #888; }

  /* Keep the strike/tint legible on mono printers too. */
  .row-unavailable { background: #fdeaea; }
  .row-unavailable .name,
  .row-unavailable .line-total { text-decoration: line-through; }
  .total-note { font-size: 10px; font-weight: 400; color: #555; }
  .row-collected { background: #eafaf0; }

  .total-label { text-align: left; font-weight: 700; background: #f0f0f0; }
  .total-value { font-weight: 700; background: #f0f0f0; }

  .foot {
    margin-top: 10px;
    padding-top: 6px;
    border-top: 1px solid #ddd;
    font-size: 10px;
    color: #777;
    text-align: center;
  }

  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }

  @media print {
    .row-unavailable { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .row-collected { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.items thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function buildPrintDocument(orders, { showPrices = true, title } = {}) {
  const pages = orders
    .map((order, index) => orderPage(order, { showPrices, isLast: index === orders.length - 1 }))
    .join('\n');

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title || T.appName)}</title>
    <style>${PRINT_CSS}</style>
  </head>
  <body>${pages}</body>
</html>`;
}

/**
 * Print one or more orders. Resolves once the print dialog has been dismissed
 * (or immediately on browsers that don't fire afterprint).
 */
export function printOrders(orders, options = {}) {
  const list = Array.isArray(orders) ? orders : [orders];
  if (!list.length) return Promise.resolve();

  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      // Delay removal so Safari doesn't cancel an in-flight print job.
      setTimeout(() => iframe.remove(), 1000);
      resolve();
    };

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(buildPrintDocument(list, options));
    doc.close();

    const run = () => {
      const win = iframe.contentWindow;
      win.addEventListener('afterprint', cleanup, { once: true });
      win.focus();
      win.print();
      // Fallback in case afterprint never fires.
      setTimeout(cleanup, 60_000);
    };

    // Wait for the embedded font so the first print isn't unshaped fallback text.
    if (iframe.contentDocument.fonts?.ready) {
      iframe.contentDocument.fonts.ready.then(run).catch(run);
    } else {
      setTimeout(run, 300);
    }
  });
}
