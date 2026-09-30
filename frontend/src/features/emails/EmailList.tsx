import { AlertCircle, ChevronLeft, ChevronRight, Clock, Filter, RotateCw, Search, SearchX, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageSpinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/cn';
import { useDebounced } from '../../lib/useDebounced';
import type { EmailView } from '../../types/api';
import { EmailRow } from './EmailRow';
import { useEmails } from './useEmails';

const EMPTY: Record<EmailView, { icon: typeof Clock; title: string; description: string }> = {
  scheduled: {
    icon: Clock,
    title: 'No scheduled emails',
    description: 'Emails you schedule show up here until they are sent.',
  },
  sent: {
    icon: Send,
    title: 'No sent emails yet',
    description: 'Sent and failed emails show up here once their scheduled time passes.',
  },
};

export function EmailList({ view }: { view: EmailView }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const { data, isPending, isError, error, refetch, isFetching } = useEmails({ view, page, q: q || undefined });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const onSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  let content;
  if (isPending) {
    content = <PageSpinner />;
  } else if (isError) {
    content = (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't load emails"
        description={error.message}
        action={
          <Button variant="outline" size="sm" loading={isFetching} onClick={() => refetch()}>
            Try again
          </Button>
        }
      />
    );
  } else if (data.items.length === 0) {
    content = q ? (
      <EmptyState icon={SearchX} title={`No results for "${q}"`} description="Try part of an address or a subject." />
    ) : (
      <EmptyState
        {...EMPTY[view]}
        action={
          <Button variant="outline" size="sm" onClick={() => navigate('/compose')}>
            Compose
          </Button>
        }
      />
    );
  } else {
    content = (
      <ul className={cn('transition-opacity', isFetching && data.page !== page && 'opacity-60')}>
        {data.items.map((email) => (
          <EmailRow key={email.id} email={email} />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 pb-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-full bg-surface px-3.5 focus-within:ring-2 focus-within:ring-brand/30">
          <Search className="size-4 text-muted" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search"
            aria-label="Search by address or subject"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
          {search && (
            <button onClick={() => onSearch('')} aria-label="Clear search" className="text-muted hover:text-ink">
              <X className="size-4" />
            </button>
          )}
        </label>
        <button disabled title="Filters aren't part of this demo" className="p-1.5 text-muted disabled:opacity-60">
          <Filter className="size-4" />
        </button>
        <button onClick={() => refetch()} aria-label="Refresh" title="Refresh" className="rounded p-1.5 text-muted hover:text-ink">
          <RotateCw className={cn('size-4', isFetching && 'animate-spin')} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-end gap-3 py-3 text-xs text-muted">
          <span>
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="rounded p-1 hover:bg-surface disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= pages}
            aria-label="Next page"
            className="rounded p-1 hover:bg-surface disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
