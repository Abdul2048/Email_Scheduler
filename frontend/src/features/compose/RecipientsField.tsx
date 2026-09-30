import { Upload, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { extractEmails } from '../../lib/extractEmails';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const VISIBLE_CHIPS = 3;

interface RecipientsFieldProps {
  value: string[];
  onChange: (emails: string[]) => void;
  max: number;
}

/** Recipient chips from typing, pasting, or uploading a CSV/TXT file. Addresses are extracted and deduped. */
export function RecipientsField({ value, onChange, max }: RecipientsFieldProps) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [lastFile, setLastFile] = useState<{ name: string; found: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const add = (found: string[]) => {
    const merged = [...new Set([...value, ...found])];
    if (merged.length > max) toast.warning(`Only the first ${max.toLocaleString()} addresses are kept.`);
    onChange(merged.slice(0, max));
    return merged.length - value.length;
  };

  const commitDraft = () => {
    if (!draft.trim()) return;
    const found = extractEmails(draft);
    if (found.length === 0) {
      toast.error(`"${draft.trim()}" isn't a valid email address.`);
      return;
    }
    add(found);
    setDraft('');
  };

  // Everything before the last comma, semicolon or space becomes chips; the unfinished part stays in the box.
  const onDraftChange = (text: string) => {
    const parts = text.split(/[,;\s]+/);
    const rest = parts.pop() ?? '';
    const found = extractEmails(parts.join(' '));
    if (found.length === 0) {
      setDraft(text);
      return;
    }
    add(found);
    setDraft(rest);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error('That file is larger than 5 MB.');
      return;
    }
    const found = extractEmails(await file.text());
    setLastFile({ name: file.name, found: found.length });
    if (found.length === 0) {
      toast.error(`No email addresses found in ${file.name}.`);
      return;
    }
    const added = add(found);
    toast.success(`${found.length.toLocaleString()} email addresses detected in ${file.name}`, {
      description: added < found.length ? `${(found.length - added).toLocaleString()} were already in the list.` : undefined,
    });
  };

  const shown = expanded ? value : value.slice(0, VISIBLE_CHIPS);
  const hidden = value.length - shown.length;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1">
          {shown.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand-soft py-0.5 pr-1 pl-2 text-xs"
            >
              {email}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== email))}
                aria-label={`Remove ${email}`}
                className="rounded-full p-0.5 text-muted hover:bg-brand-border hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-full border border-brand bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand"
            >
              +{hidden.toLocaleString()}
            </button>
          )}
          {expanded && value.length > VISIBLE_CHIPS && (
            <button type="button" onClick={() => setExpanded(false)} className="px-1 text-xs text-muted hover:text-ink">
              Show less
            </button>
          )}
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commitDraft}
            placeholder={value.length ? '' : 'recipient@example.com'}
            aria-label="Recipients"
            className="h-7 min-w-40 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
        </div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
        >
          <Upload className="size-4" />
          Upload List
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {(value.length > 0 || lastFile) && (
        <p className="pb-1 text-xs text-muted" aria-live="polite">
          <span className="font-medium text-brand">{value.length.toLocaleString()}</span>{' '}
          {value.length === 1 ? 'email address' : 'email addresses'} detected
          {lastFile && ` · ${lastFile.found.toLocaleString()} from ${lastFile.name}`}
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="ml-2 text-muted underline hover:text-ink">
              Clear all
            </button>
          )}
        </p>
      )}
    </div>
  );
}
