import { Outlet } from 'react-router-dom';
import { useMe } from '../../features/auth/useMe';
import { useEmailCounts } from '../../features/emails/useEmails';
import { useSlackResultToast } from '../../features/slack/useSlack';
import { Sidebar } from './Sidebar';

/** Sidebar + page. Only rendered inside ProtectedRoute, so the user is loaded. */
export function AppLayout() {
  const { data: user } = useMe();
  const { data: counts } = useEmailCounts();
  useSlackResultToast();
  if (!user) return null;

  return (
    <div className="flex h-full">
      <Sidebar user={user} counts={counts} />
      <main className="min-w-0 flex-1 overflow-hidden px-4 pt-3">
        <Outlet />
      </main>
    </div>
  );
}
