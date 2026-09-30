import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { ComposePage } from './pages/ComposePage';
import { EmailDetailPage } from './pages/EmailDetailPage';
import { LoginPage } from './pages/LoginPage';
import { ScheduledPage } from './pages/ScheduledPage';
import { SentPage } from './pages/SentPage';

/** The backend redirects to /dashboard after Google and Slack OAuth; keep any ?slack=... status. */
function DashboardRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/scheduled', search }} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/scheduled" element={<ScheduledPage />} />
          <Route path="/sent" element={<SentPage />} />
        </Route>
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/emails/:id" element={<EmailDetailPage />} />
      </Route>
      <Route path="/dashboard" element={<DashboardRedirect />} />
      <Route path="*" element={<Navigate to="/scheduled" replace />} />
    </Routes>
  );
}
