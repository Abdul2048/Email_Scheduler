import { Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { formatFull, formatScheduleBadge, formatShort } from '../../lib/date';
import type { EmailItem } from '../../types/api';

export function EmailRow({ email }: { email: EmailItem }) {
  const sentView = email.status === 'SENT' || email.status === 'FAILED';
  const when = sentView ? (email.sentAt ?? email.scheduledAt) : email.scheduledAt;

  return (
    <li className="border-b border-line">
      <Link
        to={`/emails/${email.id}`}
        className="flex items-center gap-4 px-4 py-2.5 transition-colors hover:bg-surface/70"
      >
        <span className="w-[26%] max-w-44 shrink-0 truncate text-[13px] font-medium" title={email.toEmail}>
          To: {email.toEmail}
        </span>
        <StatusBadge
          status={email.status}
          time={formatScheduleBadge(email.scheduledAt)}
          title={email.error ?? `${sentView ? 'Sent' : 'Scheduled for'} ${formatFull(when)}`}
        />
        <span className="min-w-0 flex-1 truncate text-[13px]">
          <span className="font-medium">{email.subject}</span>
          {email.bodyPreview && <span className="text-muted"> - {email.bodyPreview}</span>}
        </span>
        {sentView && (
          <time dateTime={when} title={formatFull(when)} className="shrink-0 text-xs text-muted">
            {formatShort(when)}
          </time>
        )}
        <Star className="size-4 shrink-0 text-subtle" aria-hidden="true" />
      </Link>
    </li>
  );
}
