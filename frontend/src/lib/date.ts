const DAY_MS = 24 * 60 * 60 * 1000;

const time = (d: Date, seconds = false) =>
  d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', ...(seconds && { second: '2-digit' }) });

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Figma's scheduled pill: "Tue 9:15:12 AM" within the coming week, "Oct 14, 9:15 AM" further out. */
export function formatScheduleBadge(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return `Today ${time(d, true)}`;
  if (Math.abs(d.getTime() - now.getTime()) < 6 * DAY_MS) {
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time(d, true)}`;
  }
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time(d)}`;
}

/** Short time for list rows: "10:23 AM" today, "Nov 3" this year, "Nov 3, 2025" otherwise. */
export function formatShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameDay(d, now)) return time(d);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

/** Full timestamp for the detail view and tooltips: "Nov 3, 2026, 10:23:05 AM". */
export function formatFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

/** Value for <input type="datetime-local"> in the browser's timezone. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
