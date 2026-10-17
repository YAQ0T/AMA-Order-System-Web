import { useState } from 'react';

import OrderForm from '../../components/OrderForm';
import OrderFilters from '../../components/OrderFilters';
import OrderTable from '../../components/OrderTable';
import OrderEditModal from '../../components/OrderEditModal';
import { ConfirmDialog, ErrorState, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useOrdersQuery, useUpdateOrder, useDeleteOrder } from '../../hooks/useOrders';
import { printOrders } from '../../print/printOrders';
import { T } from '../../lib/labels';
import { orderTitle } from '../../lib/format';
import Pagination from '../../components/Pagination';

const STATUSES = ['active', 'pending', 'in-progress', 'completed', 'entered_erp', 'all'];
const PAGE_SIZE = 20;

export default function MakerActive() {
  const toast = useToast();
  const [status, setStatus] = useState('active');
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

  const changeFilter = (setter) => (value) => {
    setter(value);
    setPage(0);
  };

  const onStatusChange = async (order, nextStatus) => {
    try {
      if (nextStatus === 'archived') {
        // Archiving is a "pull back to draft" action: it also clears the
        // assignment, matching the Flutter maker dashboard.
        await updateOrder.mutateAsync({
          id: order.id,
          payload: { status: 'archived', assignedTakerIds: [], accounterId: null },
        });
      } else {
        await updateOrder.mutateAsync({ id: order.id, payload: { status: nextStatus } });
      }
      toast.success(T.save);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteOrder.mutateAsync(deleting.id);
      toast.success(T.delete);
    } catch (err) {
      toast.error(err?.message || T.somethingWentWrong);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <OrderForm />

      <OrderFilters
        status={status}
        onStatusChange={changeFilter(setStatus)}
        allowedStatuses={STATUSES}
        search={search}
        onSearchChange={changeFilter(setSearch)}
        city={city}
        onCityChange={changeFilter(setCity)}
        showCity
      />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <>
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
        </>
      )}

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
