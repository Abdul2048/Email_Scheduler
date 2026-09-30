import { Clock } from 'lucide-react';
import type { EmailStatus } from '../../types/api';
import { cn } from '../../lib/cn';

const styles: Record<EmailStatus, { label: string; className: string }> = {
  SCHEDULED: { label: 'Scheduled', className: 'bg-warn-soft text-warn border-warn-border' },
  DEFERRED: { label: 'Deferred', className: 'bg-warn-soft text-warn border-warn-border' },
  SENDING: { label: 'Sending', className: 'bg-brand-soft text-brand border-brand-border' },
  SENT: { label: 'Sent', className: 'bg-surface text-ink/70 border-line' },
  FAILED: { label: 'Failed', className: 'bg-danger-soft text-danger border-danger/20' },
};

/**
 * Pill from the Figma list rows. Pending emails show their send time (Figma), plus "Deferred" when the
 * sender's hourly limit pushed them into a later hour.
 */
export function StatusBadge({ status, time, title }: { status: EmailStatus; time?: string; title?: string }) {
  const { label, className } = styles[status];
  const pending = status === 'SCHEDULED' || status === 'DEFERRED';
  const text = pending && time ? (status === 'DEFERRED' ? `${time} · Deferred` : time) : label;
  return (
    <span
      title={title ?? label}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        className,
      )}
    >
      {pending && <Clock className="size-3" />}
      {text}
    </span>
  );
}
