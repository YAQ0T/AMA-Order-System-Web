import { T } from '../lib/labels';
import { formatDate, formatDateTime, formatQuantity } from '../lib/format';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function countTable(title, rows, { quantity = false } = {}) {
  if (!rows.length) return '';
  return `
    <section class="block">
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead><tr><th class="name">${escapeHtml(T.itemName)}</th><th class="num">${escapeHtml(quantity ? T.quantity : T.total)}</th></tr></thead>
        <tbody>
          ${rows
            .map(
              ([name, value]) => `
            <tr>
              <td class="name">${escapeHtml(name)}</td>
              <td class="num"><span dir="ltr">${escapeHtml(quantity ? formatQuantity(value) : value)}</span></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </section>`;
}

const CSS = `
  @page { size: A4; margin: 12mm; }

  @font-face {
    font-family: 'Noto Sans Arabic';
    src: url('/fonts/NotoSansArabic-Regular.ttf') format('truetype');
    font-weight: 100 900;
  }

  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Noto Sans Arabic', system-ui, 'Segoe UI', sans-serif;
    color: #000; background: #fff; font-size: 12px;
  }
  [dir='ltr'] { unicode-bidi: isolate; display: inline-block; }

  h1 { font-size: 20px; margin: 0 0 4px; text-align: center; }
  .range { text-align: center; color: #555; margin-bottom: 14px; font-size: 12px; }

  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .stat {
    flex: 1 1 140px; border: 1px solid #ccc; border-radius: 6px;
    padding: 8px 10px; background: #f7f7f7;
  }
  .stat .label { font-size: 10px; color: #666; }
  .stat .value { font-size: 18px; font-weight: 700; }

  .block { margin-bottom: 16px; page-break-inside: avoid; }
  .block h2 { font-size: 13px; margin: 0 0 6px; padding-bottom: 3px; border-bottom: 1px solid #999; }

  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: right; }
  thead th { background: #e8e8e8; font-size: 11px; }
  .num { text-align: center; width: 80px; }

  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }

  .foot { margin-top: 12px; border-top: 1px solid #ddd; padding-top: 6px;
          font-size: 10px; color: #777; text-align: center; }

  @media print {
    .stat, thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

export function buildReportDocument(report, { title } = {}) {
  const heading = title || T.reports;

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(heading)}</title>
    <style>${CSS}</style>
  </head>
  <body>
    <h1>${escapeHtml(T.appName)} — ${escapeHtml(heading)}</h1>
    <p class="range">
      ${escapeHtml(T.from)} <span dir="ltr">${escapeHtml(formatDate(report.from))}</span>
      ${escapeHtml(T.to)} <span dir="ltr">${escapeHtml(formatDate(report.to))}</span>
    </p>

    <div class="stats">
      <div class="stat">
        <div class="label">${escapeHtml(T.ordersInRange)}</div>
        <div class="value"><span dir="ltr">${report.orderCount}</span></div>
      </div>
      <div class="stat">
        <div class="label">${escapeHtml(T.totalQuantitySold)}</div>
        <div class="value"><span dir="ltr">${escapeHtml(formatQuantity(report.totalSoldQuantity))}</span></div>
      </div>
      <div class="stat">
        <div class="label">${escapeHtml(T.productsSold)}</div>
        <div class="value"><span dir="ltr">${report.productsSold.length}</span></div>
      </div>
      <div class="stat">
        <div class="label">${escapeHtml(T.unavailableProducts)}</div>
        <div class="value"><span dir="ltr">${report.unavailableProducts.length}</span></div>
      </div>
    </div>

    ${countTable(T.productsSold, report.productsSold, { quantity: true })}
    ${countTable(T.unavailableProducts, report.unavailableProducts, { quantity: true })}
    ${countTable(T.takerAssignments, report.takerAssignments)}
    ${countTable(T.customerOrders, report.customerOrders)}

    <div class="foot"><span dir="ltr">${escapeHtml(formatDateTime(new Date()))}</span></div>
  </body>
</html>`;
}

export function printReport(report, options = {}) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      setTimeout(() => iframe.remove(), 1000);
      resolve();
    };

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(buildReportDocument(report, options));
    doc.close();

    const run = () => {
      const win = iframe.contentWindow;
      win.addEventListener('afterprint', cleanup, { once: true });
      win.focus();
      win.print();
      setTimeout(cleanup, 60_000);
    };

    if (doc.fonts?.ready) {
      doc.fonts.ready.then(run).catch(run);
    } else {
      setTimeout(run, 300);
    }
  });
}
