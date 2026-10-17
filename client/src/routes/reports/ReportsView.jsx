import { useState } from 'react';

import { useAuth } from '../../store/auth';
import * as ordersApi from '../../api/orders';
import { buildReport } from '../../lib/report';
import { T } from '../../lib/labels';
import { formatDate, formatQuantity, toDateInputValue } from '../../lib/format';
import { EmptyState, Ltr, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { printReport } from '../../print/printReport';

function CountTable({ title, rows, unit }) {
  if (!rows.length) return null;
  return (
    <section className="card p-4">
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([name, value]) => (
            <tr key={name} className="border-b border-slate-100 last:border-0 dark:border-slate-700/60">
              <td className="py-1.5">{name}</td>
              <td className="w-20 py-1.5 text-end font-bold">
                <Ltr>{unit === 'qty' ? formatQuantity(value) : value}</Ltr>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500 dark:text-ink-400">{label}</p>
      <p className="mt-1 text-2xl font-bold">
        <Ltr>{value}</Ltr>
      </p>
    </div>
  );
}

export default function ReportsView({ title }) {
  const role = useAuth((s) => s.user?.role);
  const toast = useToast();

  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  const [from, setFrom] = useState(toDateInputValue(monthAgo));
  const [to, setTo] = useState(toDateInputValue(today));
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const all = await ordersApi.fetchAllOrders({
        role,
        status: 'all',
        onProgress: setProgress,
      });
      setReport(buildReport(all, new Date(from), new Date(to)));
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="sm:w-44">
          <label className="label" htmlFor="report-from">
            {T.from}
          </label>
          <input
            id="report-from"
            type="date"
            className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="sm:w-44">
          <label className="label" htmlFor="report-to">
            {T.to}
          </label>
          <input
            id="report-to"
            type="date"
            className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <button type="button" className="btn-primary" onClick={generate} disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : null}
          {busy ? `${T.generating} (${progress})` : T.generateReport}
        </button>

        {report && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => printReport(report, { title })}
          >
            {T.printReport}
          </button>
        )}
      </div>

      {!report && !busy && <EmptyState>{T.noReportData}</EmptyState>}

      {report && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-500 dark:text-ink-400">
            {T.from} <Ltr>{formatDate(report.from)}</Ltr> {T.to}{' '}
            <Ltr>{formatDate(report.to)}</Ltr>
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={T.ordersInRange} value={report.orderCount} />
            <StatCard label={T.totalQuantitySold} value={formatQuantity(report.totalSoldQuantity)} />
            <StatCard label={T.productsSold} value={report.productsSold.length} />
            <StatCard label={T.unavailableProducts} value={report.unavailableProducts.length} />
          </div>

          {report.orderCount === 0 ? (
            <EmptyState>{T.noReportData}</EmptyState>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <CountTable title={T.productsSold} rows={report.productsSold} unit="qty" />
              <CountTable title={T.unavailableProducts} rows={report.unavailableProducts} unit="qty" />
              <CountTable title={T.takerAssignments} rows={report.takerAssignments} />
              <CountTable title={T.customerOrders} rows={report.customerOrders} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
