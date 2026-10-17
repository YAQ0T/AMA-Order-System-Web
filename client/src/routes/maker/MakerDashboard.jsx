import { Navigate, Route, Routes } from 'react-router-dom';

import { TabLinks } from '../../components/ui';
import { T } from '../../lib/labels';
import MakerActive from './MakerActive';
import MakerArchived from './MakerArchived';
import ReportsView from '../reports/ReportsView';

export default function MakerDashboard() {
  return (
    <>
      <TabLinks
        tabs={[
          { to: '/maker/active', label: T.active },
          { to: '/maker/archived', label: T.archived },
          { to: '/maker/reports', label: T.reports },
        ]}
      />

      <Routes>
        <Route index element={<Navigate to="active" replace />} />
        <Route path="active" element={<MakerActive />} />
        <Route path="archived" element={<MakerArchived />} />
        <Route path="reports" element={<ReportsView title={T.reports} />} />
        <Route path="*" element={<Navigate to="active" replace />} />
      </Routes>
    </>
  );
}
