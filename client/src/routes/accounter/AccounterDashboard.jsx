import { useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import OrderFilters from '../../components/OrderFilters';
import OrderTable from '../../components/OrderTable';
import Pagination from '../../components/Pagination';
import { ConfirmDialog, ErrorState, Spinner, TabLinks } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useOrdersQuery, useUpdateOrder } from '../../hooks/useOrders';
import { printOrders } from '../../print/printOrders';
import { T } from '../../lib/labels';

const PAGE_SIZE = 20;

function AccounterList({ status }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sending, setSending] = useState(null);

  const query = useOrdersQuery({
    status,
    search,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
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
        emptyMessage={status === 'entered_erp' ? T.noOrders : T.noOrders}
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

export default function AccounterDashboard() {
  const location = useLocation();

  return (
    <>
      <TabLinks
        tabs={[
          { to: '/accounter/completed', label: T.completed },
          { to: '/accounter/erp', label: T.enteredErp },
        ]}
      />

      <Routes>
        <Route index element={<Navigate to="completed" replace />} />
        {/* key= forces a remount so search/page state resets between tabs */}
        <Route
          path="completed"
          element={<AccounterList key={location.pathname} status="completed" />}
        />
        <Route
          path="erp"
          element={<AccounterList key={location.pathname} status="entered_erp" />}
        />
        <Route path="*" element={<Navigate to="completed" replace />} />
      </Routes>
    </>
  );
}
