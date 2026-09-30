import { ServerCrash } from 'lucide-react';
import { Navigate, Outlet } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageSpinner } from '../../components/ui/Spinner';
import { useMe } from './useMe';

export function ProtectedRoute() {
  const { data: user, isPending, isError, refetch, isFetching } = useMe();

  if (isPending) return <PageSpinner />;
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={ServerCrash}
          title="Can't reach the server"
          description="The API isn't responding. Check that the backend is running, then try again."
          action={
            <Button variant="outline" size="sm" loading={isFetching} onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
