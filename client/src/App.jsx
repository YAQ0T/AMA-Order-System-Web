import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from './store/auth';
import { resumePush } from './lib/push';
import Shell from './components/Shell';
import Login from './routes/Login';
import Signup from './routes/Signup';
import PendingApproval from './routes/PendingApproval';
import MakerDashboard from './routes/maker/MakerDashboard';
import TakerDashboard from './routes/taker/TakerDashboard';
import AccounterDashboard from './routes/accounter/AccounterDashboard';
import AdminDashboard from './routes/admin/AdminDashboard';
import { T } from './lib/labels';

const HOME_FOR_ROLE = {
  maker: '/maker',
  taker: '/taker',
  accounter: '/accounter',
  admin: '/admin',
};

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      <span className="sr-only">{T.loading}</span>
    </div>
  );
}

function RequireAuth({ roles, children }) {
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);
  const location = useLocation();

  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!user.isApproved && user.role !== 'admin') {
    return <Navigate to="/pending" replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={HOME_FOR_ROLE[user.role] || '/login'} replace />;
  }
  return children;
}

function HomeRedirect() {
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);

  if (!token || !user) return <Navigate to="/login" replace />;
  if (!user.isApproved && user.role !== 'admin') return <Navigate to="/pending" replace />;
  return <Navigate to={HOME_FOR_ROLE[user.role] || '/login'} replace />;
}

export default function App() {
  const init = useAuth((s) => s.init);
  const initializing = useAuth((s) => s.initializing);
  const token = useAuth((s) => s.token);

  useEffect(() => {
    init();
  }, [init]);

  // Re-subscribe on load if the user already granted permission. Push
  // endpoints rotate, so this keeps the server's copy current.
  useEffect(() => {
    if (token) resumePush();
  }, [token]);

  if (initializing) return <FullPageSpinner />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/pending" element={<PendingApproval />} />

      <Route element={<Shell />}>
        <Route path="/" element={<HomeRedirect />} />
        <Route
          path="/maker/*"
          element={
            <RequireAuth roles={['maker', 'admin']}>
              <MakerDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/taker/*"
          element={
            <RequireAuth roles={['taker']}>
              <TakerDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/accounter/*"
          element={
            <RequireAuth roles={['accounter']}>
              <AccounterDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/*"
          element={
            <RequireAuth roles={['admin']}>
              <AdminDashboard />
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
