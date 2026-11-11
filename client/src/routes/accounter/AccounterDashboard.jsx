import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import OrderFilters from '../../components/OrderFilters';
import OrderTable from '../../components/OrderTable';
import Pagination from '../../components/Pagination';
import { ConfirmDialog, ErrorState, Ltr, Spinner, TabLinks } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  useOrdersQuery,
  useUpdateOrder,
  useAvailableForAccountingQuery,
  useClaimForAccounting,
} from '../../hooks/useOrders';
import { printOrders } from '../../print/printOrders';
import { T } from '../../lib/labels';
import TelegramLinkCard from '../../components/TelegramLinkCard';

const PAGE_SIZE = 20;

/**
 * How an accountant gets orders: nobody picks the accountant any more. When
 * an order is completed it is offered to every accountant («جاهزة للمحاسبة»);
 * the first to take it gets it, and it moves to their «طلباتي» until they
 * send it to ERP.
 */

/** The accountant's own orders: taken by them, completed (to send to ERP) or already entered. */
function AccounterList({ status, availableCount }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sending, setSending] = useState(null);

  const query = useOrdersQuery({
    status,
    search,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    // An order sent back to the takers leaves this list, and comes back
    // when it is completed again - without a reload.
    refetchInterval: 30_000,
  });

  const updateOrder = useUpdateOrder();

  const orders = query.data?.orders ?? [];
  const total = query.data?.pagination?.total ?? 0;

  const sendToErp = async () => {
    if (!sending) return;
    try {
      await updateOrder.mutateAsync({ id: sending.id, payload: { status: 'entered_erp' } });
      toast.success(T.sendToErp);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setSending(null);
    }
  };

  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <div>
      <OrderFilters
        status={status}
        statusEnabled={false}
        allowedStatuses={[status]}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
      />

      {query.isFetching && (
        <div className="mb-2 flex justify-center">
          <Spinner className="h-5 w-5 text-brand-500" />
        </div>
      )}

      <OrderTable
        orders={orders}
        showPrices
        showHistory
        onPrint={(order) => printOrders(order, { showPrices: true })}
        onSendToErp={status === 'completed' ? setSending : undefined}
        emptyMessage={
          status === 'completed' && availableCount > 0 && !search ? (
            <>
              {T.noOrders}.{' '}
              <Link to="/accounter/available" className="font-bold text-brand-600 hover:underline dark:text-indigo">
                {T.availableForAccounting} (<Ltr>{availableCount}</Ltr>)
              </Link>
            </>
          ) : undefined
        }
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      <ConfirmDialog
        open={Boolean(sending)}
        title={T.sendToErp}
        message={sending ? `#${sending.id} — ${T.confirmSendToErp}` : ''}
        confirmLabel={T.send}
        tone="primary"
        onConfirm={sendToErp}
        onCancel={() => setSending(null)}
      />
    </div>
  );
}

/** Completed orders nobody has taken yet: the first accountant to take one gets it. */
function AccounterAvailable() {
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [claiming, setClaiming] = useState(null);

  const query = useAvailableForAccountingQuery({ search, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const claim = useClaimForAccounting();

  const orders = query.data?.orders ?? [];
  const total = query.data?.pagination?.total ?? 0;

  const confirmClaim = async () => {
    const order = claiming;
    if (!order || claim.isPending) return;
    try {
      await claim.mutateAsync(order.id);
      toast.success(T.takenForAccounting);
      navigate('/accounter/mine');
    } catch (err) {
      toast.error(err?.status === 409 ? T.alreadyTakenByAccountant : err?.message || T.somethingWentWrong);
    } finally {
      setClaiming(null);
    }
  };

  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600 dark:text-ink-400">{T.availableForAccountingHint}</p>

      <OrderFilters
        statusEnabled={false}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
      />

      {query.isFetching && (
        <div className="mb-2 flex justify-center">
          <Spinner className="h-5 w-5 text-brand-500" />
        </div>
      )}

      <OrderTable
        orders={orders}
        showPrices
        showHistory={false}
        emptyMessage={T.noAvailableForAccounting}
        onPrint={(order) => printOrders(order, { showPrices: true })}
        extraActions={(order) => (
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={claim.isPending}
            onClick={() => setClaiming(order)}
          >
            {T.takeForAccounting}
          </button>
        )}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      <ConfirmDialog
        open={Boolean(claiming)}
        title={T.takeForAccounting}
        message={claiming ? T.takeForAccountingConfirm(claiming.id) : ''}
        confirmLabel={T.takeForAccounting}
        tone="primary"
        onConfirm={confirmClaim}
        onCancel={() => setClaiming(null)}
      />
    </div>
  );
}

export default function AccounterDashboard() {
  const location = useLocation();
  // Same query (and cache entry) as the available tab's first page, so the
  // badge costs nothing extra and stays in step with the list.
  const available = useAvailableForAccountingQuery({ limit: PAGE_SIZE, offset: 0 });
  const availableCount = available.data?.pagination?.total ?? 0;

  return (
    <>
      <TelegramLinkCard />

      <TabLinks
        tabs={[
          { to: '/accounter/mine', label: T.myAccountingOrders },
          {
            to: '/accounter/available',
            label: (
              <span className="inline-flex items-center gap-1.5">
                {T.availableForAccounting}
                {availableCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-2 text-xs leading-5 text-white">
                    <Ltr>{availableCount}</Ltr>
                  </span>
                )}
              </span>
            ),
          },
          { to: '/accounter/erp', label: T.enteredErp },
        ]}
      />

      <Routes>
        <Route index element={<Navigate to="mine" replace />} />
        {/* key= forces a remount so search/page state resets between tabs */}
        <Route
          path="mine"
          element={<AccounterList key={location.pathname} status="completed" availableCount={availableCount} />}
        />
        <Route path="available" element={<AccounterAvailable />} />
        <Route
          path="erp"
          element={<AccounterList key={location.pathname} status="entered_erp" availableCount={availableCount} />}
        />
        {/* Older links (and bookmarks) said /accounter/completed. */}
        <Route path="completed" element={<Navigate to="/accounter/mine" replace />} />
        <Route path="*" element={<Navigate to="mine" replace />} />
      </Routes>
    </>
  );
}
