import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import { toLocalInputValue } from '../../lib/date';

function tomorrowAt(hour?: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (hour !== undefined) d.setHours(hour, 0, 0, 0);
  else d.setSeconds(0, 0);
  return d;
}

const PRESETS: { label: string; at: () => Date }[] = [
  { label: 'Tomorrow', at: () => tomorrowAt() },
  { label: 'Tomorrow, 10:00 AM', at: () => tomorrowAt(10) },
  { label: 'Tomorrow, 11:00 AM', at: () => tomorrowAt(11) },
  { label: 'Tomorrow, 3:00 PM', at: () => tomorrowAt(15) },
];

interface SendLaterPopoverProps {
  value: Date | null;
  onDone: (at: Date | null) => void;
  onClose: () => void;
}

/** Figma "Send Later" card: pick a start time or a preset. Cancel keeps the previous choice. */
export function SendLaterPopover({ value, onDone, onClose }: SendLaterPopoverProps) {
  const [draft, setDraft] = useState(value ? toLocalInputValue(value) : '');
  const ref = useRef<HTMLDivElement>(null);
  const draftDate = draft ? new Date(draft) : null;
  const inPast = draftDate !== null && draftDate.getTime() < Date.now() - 60_000;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest('[data-send-later-trigger]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Send later"
      className="absolute top-full right-0 z-30 mt-2 w-72 rounded-xl border border-line bg-white p-4 shadow-xl"
    >
      <h2 className="mb-3 font-semibold">Send Later</h2>
      <label className="flex items-center gap-2 border-b border-line pb-2 text-[13px]">
        <input
          type="datetime-local"
          value={draft}
          min={toLocalInputValue(new Date())}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Pick date & time"
          className={cn('flex-1 bg-transparent outline-none', !draft && 'text-muted')}
        />
      </label>
      {inPast && <p className="mt-1 text-xs text-danger">Pick a time in the future.</p>}

      <ul className="mt-3 space-y-0.5">
        {PRESETS.map((p) => (
          <li key={p.label}>
            <button
              type="button"
              onClick={() => setDraft(toLocalInputValue(p.at()))}
              className="w-full rounded-md px-1 py-1.5 text-left text-[13px] text-ink/80 hover:bg-surface"
            >
              {p.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-end gap-2">
        {value && (
          <button type="button" onClick={() => onDone(null)} className="mr-auto text-xs text-muted underline hover:text-ink">
            Send now instead
          </button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" disabled={!draftDate || inPast} onClick={() => onDone(draftDate)}>
          Done
        </Button>
      </div>
    </div>
  );
}
