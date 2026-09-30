import { AlertCircle, Archive, ArrowLeft, ExternalLink, MailX, Star, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSpinner } from '../components/ui/Spinner';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useMe } from '../features/auth/useMe';
import { useEmail } from '../features/emails/useEmails';
import { formatFull, formatScheduleBadge } from '../lib/date';

export function EmailDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: user } = useMe();
  const { data: email, isPending, isError, error, refetch, isFetching } = useEmail(id);
  const sent = email?.status === 'SENT' || email?.status === 'FAILED';
  const back = () => navigate(sent ? '/sent' : '/scheduled');

  let content;
  if (isPending) {
    content = <PageSpinner />;
  } else if (isError) {
    content =
      error instanceof ApiError && error.status === 404 ? (
        <EmptyState icon={MailX} title="Email not found" description="It may have been removed, or it belongs to another account." />
      ) : (
        <EmptyState
          icon={AlertCircle}
          title="Couldn't load this email"
          description={error.message}
          action={
            <Button variant="outline" size="sm" loading={isFetching} onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      );
  } else {
    const when = email.sentAt ?? email.scheduledAt;
    content = (
      <article className="mx-auto max-w-3xl px-4 pt-6 pb-12">
        <header className="flex items-start gap-3">
          <Avatar name={email.senderEmail} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px]">
              <span className="font-semibold">{email.senderEmail.split('@')[0]}</span>{' '}
              <span className="text-muted">&lt;{email.senderEmail}&gt;</span>
            </p>
            <p className="truncate text-xs text-muted">to {email.toEmail}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <time dateTime={when} className="text-xs text-muted">
              {email.sentAt ? '' : 'Scheduled for '}
              {formatFull(when)}
            </time>
            <StatusBadge status={email.status} time={formatScheduleBadge(email.scheduledAt)} />
          </div>
        </header>

        {email.error && (
          <p role="alert" className="mt-5 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {email.error}
          </p>
        )}

        <div className="mt-6 pl-12 text-[13px] leading-relaxed whitespace-pre-wrap">{email.body}</div>

        {email.previewUrl && (
          <a
            href={email.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-8 ml-12 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
          >
            View the delivered message on Ethereal
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </article>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={back} aria-label="Back" className="rounded p-1 hover:bg-surface">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-medium">{email?.subject ?? 'Email'}</h1>
        <div className="flex items-center gap-1 text-muted" aria-hidden="true">
          {[Star, Archive, Trash2].map((Icon, i) => (
            <span key={i} className="p-1.5 opacity-70" title="Not part of this demo">
              <Icon className="size-4" />
            </span>
          ))}
        </div>
        <span className="h-6 w-px bg-line" />
        {user && (
          <Link to="/scheduled" title={user.email}>
            <Avatar name={user.name} src={user.avatarUrl} />
          </Link>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </div>
  );
}
