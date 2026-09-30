import { AlertCircle, ArrowLeft, Clock, Paperclip, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import { EditorToolbar } from '../features/compose/EditorToolbar';
import { RecipientsField } from '../features/compose/RecipientsField';
import { SendLaterPopover } from '../features/compose/SendLaterPopover';
import { useCreateCampaign } from '../features/compose/useCreateCampaign';
import { cn } from '../lib/cn';
/** Same bounds as the backend's campaign schema. */
const MAX_LEADS = 10_000;
const MAX_DELAY_SEC = 3600;
const MAX_HOURLY_LIMIT = 100_000;

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-4', className)}>
      <span className="w-12 shrink-0 text-xs text-ink/80">{label}</span>
      {children}
    </div>
  );
}

function NumberField(props: { label: string; value: string; onChange: (v: string) => void; unit?: string; step?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink/80">
      {props.label}
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={props.step ?? '1'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="00"
        className="h-8 w-16 rounded-md border border-line px-2 text-[13px] text-ink outline-none placeholder:text-subtle focus:ring-2 focus:ring-brand/30"
      />
      {props.unit && <span className="text-muted">{props.unit}</span>}
    </label>
  );
}

function validate(f: { leads: string[]; subject: string; body: string; delay: string; limit: string; startAt: Date | null }) {
  if (f.leads.length === 0) return 'Add at least one recipient, or upload a list.';
  if (f.leads.length > MAX_LEADS) return `At most ${MAX_LEADS.toLocaleString()} recipients per campaign.`;
  if (!f.subject.trim()) return 'Add a subject.';
  if (!f.body.trim()) return 'Write the email body.';
  const delay = Number(f.delay);
  if (f.delay.trim() === '' || !Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_SEC) {
    return `Delay between emails must be 0–${MAX_DELAY_SEC} seconds.`;
  }
  const limit = Number(f.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HOURLY_LIMIT) {
    return `Hourly limit must be a whole number from 1 to ${MAX_HOURLY_LIMIT.toLocaleString()}.`;
  }
  if (f.startAt && f.startAt.getTime() < Date.now() - 60_000) return 'The start time is in the past. Pick a new one.';
  return null;
}

export function ComposePage() {
  const navigate = useNavigate();
  const create = useCreateCampaign();
  const [leads, setLeads] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delay, setDelay] = useState('2');
  const [limit, setLimit] = useState('200');
  const [startAt, setStartAt] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const problem = validate({ leads, subject, body, delay, limit, startAt });
    setError(problem);
    if (problem) return;
    create.mutate({
      subject: subject.trim(),
      body,
      leads,
      startAt: (startAt ?? new Date()).toISOString(),
      delayBetweenEmailsSec: Number(delay),
      hourlyLimit: Number(limit),
    });
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => navigate(-1)} aria-label="Back" className="rounded p-1 hover:bg-surface">
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="flex-1 text-lg font-medium">Compose New Email</h1>

        {startAt && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pr-1 pl-2.5 text-xs">
            Starts {startAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            <button type="button" onClick={() => setStartAt(null)} aria-label="Send now instead" className="rounded-full p-0.5 hover:bg-brand-border">
              <X className="size-3" />
            </button>
          </span>
        )}
        <span className="p-1.5 text-muted" title="Attachments aren't part of this demo" aria-hidden="true">
          <Paperclip className="size-4" />
        </span>
        <div className="relative">
          <button
            type="button"
            data-send-later-trigger
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Send later"
            aria-expanded={pickerOpen}
            className={cn('rounded p-1.5 hover:bg-surface', startAt ? 'text-brand' : 'text-muted')}
          >
            <Clock className="size-4" />
          </button>
          {pickerOpen && (
            <SendLaterPopover
              value={startAt}
              onClose={() => setPickerOpen(false)}
              onDone={(at) => {
                setStartAt(at);
                setPickerOpen(false);
              }}
            />
          )}
        </div>
        <Button type="submit" variant="outline" size="sm" loading={create.isPending} className="px-6">
          {startAt ? 'Send Later' : 'Send'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 pb-10">
          {error && (
            <p role="alert" className="mb-2 flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-danger">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </p>
          )}

          <Row label="From" className="py-2">
            <span
              className="rounded-lg bg-surface px-3 py-1.5 text-[13px]"
              title="Emails are spread across the Ethereal sender accounts, each with its own hourly limit"
            >
              Ethereal senders (rotating)
            </span>
          </Row>
          <Row label="To" className="items-start border-b border-line py-1.5">
            <RecipientsField value={leads} onChange={setLeads} max={MAX_LEADS} />
          </Row>
          <Row label="Subject" className="border-b border-line py-1.5">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={998}
              placeholder="Subject"
              aria-label="Subject"
              className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
            />
          </Row>

          <div className="flex flex-wrap items-center gap-6 py-3">
            <NumberField label="Delay between 2 emails" value={delay} onChange={setDelay} unit="sec" step="any" />
            <NumberField label="Hourly Limit" value={limit} onChange={setLimit} />
          </div>

          <div className="flex min-h-80 flex-col gap-3 rounded-xl bg-surface p-3">
            <EditorToolbar />
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type Your Reply..."
              aria-label="Body"
              className="min-h-64 flex-1 bg-transparent px-1 focus:ring-0"
            />
          </div>
        </div>
      </div>
    </form>
  );
}
