import { useState } from 'react';

import OrderFilters from '../../components/OrderFilters';
import OrderTable from '../../components/OrderTable';
import OrderEditModal from '../../components/OrderEditModal';
import Pagination from '../../components/Pagination';
import { ConfirmDialog, ErrorState, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useOrdersQuery, useUpdateOrder, useDeleteOrder } from '../../hooks/useOrders';
import { printOrders } from '../../print/printOrders';
import { T } from '../../lib/labels';
import { orderTitle } from '../../lib/format';

const PAGE_SIZE = 20;
const STATUSES = ['all', 'active', 'pending', 'in-progress', 'completed', 'archived', 'entered_erp'];

export default function AdminOrders() {
  const toast = useToast();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const query = useOrdersQuery({
    status,
    search,
    city,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const updateOrder = useUpdateOrder();
  const deleteOrder = useDeleteOrder();

  const orders = query.data?.orders ?? [];
  const total = query.data?.pagination?.total ?? 0;

  const reset = (setter) => (value) => {
    setter(value);
    setPage(0);
  };

  const onStatusChange = async (order, nextStatus) => {
    try {
      await updateOrder.mutateAsync({ id: order.id, payload: { status: nextStatus } });
      toast.success(T.saved);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteOrder.mutateAsync(deleting.id);
      toast.success(T.deleted);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setDeleting(null);
    }
  };

  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;

  return (
    <div>
      <OrderFilters
        status={status}
        onStatusChange={reset(setStatus)}
        allowedStatuses={STATUSES}
        search={search}
        onSearchChange={reset(setSearch)}
        city={city}
        onCityChange={reset(setCity)}
        showCity
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
        onEdit={setEditing}
        onDelete={setDeleting}
        onPrint={(order) => printOrders(order, { showPrices: true })}
        onStatusChange={onStatusChange}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      {editing && (
        <OrderEditModal
          key={editing.id}
          order={editing}
          open
          onClose={() => setEditing(null)}
          showPrices
          canAssign
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={T.delete}
        message={deleting ? `${orderTitle(deleting)} — ${T.confirmDeleteOrder}` : ''}
        confirmLabel={T.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
