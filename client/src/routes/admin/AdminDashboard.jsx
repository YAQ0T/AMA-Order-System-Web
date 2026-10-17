import { Navigate, Route, Routes } from 'react-router-dom';

import { TabLinks } from '../../components/ui';
import { T } from '../../lib/labels';
import AdminOverview from './AdminOverview';
import AdminUsers from './AdminUsers';
import AdminOrders from './AdminOrders';
import AdminLogs from './AdminLogs';
import AdminBackups from './AdminBackups';
import ReportsView from '../reports/ReportsView';

export default function AdminDashboard() {
  return (
    <>
      <TabLinks
        tabs={[
          { to: '/admin/overview', label: T.overview },
          { to: '/admin/users', label: T.users },
          { to: '/admin/orders', label: T.orders },
          { to: '/admin/logs', label: T.logs },
          { to: '/admin/reports', label: T.reports },
          { to: '/admin/backups', label: T.backups },
        ]}
      />

      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<AdminOverview />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="orders" element={<AdminOrders />} />
        <Route path="logs" element={<AdminLogs />} />
        <Route path="reports" element={<ReportsView title={T.reports} />} />
        <Route path="backups" element={<AdminBackups />} />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Routes>
    </>
  );
}
