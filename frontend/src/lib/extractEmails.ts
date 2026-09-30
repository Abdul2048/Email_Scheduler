const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

/** Every distinct email address in free text (CSV cells, one per line, pasted lists), in first-seen order. */
export function extractEmails(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(EMAIL_RE)) seen.add(match[0].toLowerCase());
  return [...seen];
}
