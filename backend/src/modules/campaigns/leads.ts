const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export interface CleanedLeads {
  emails: string[];
  invalidCount: number;
  duplicateCount: number;
}

export function cleanLeads(raw: string[]): CleanedLeads {
  const seen = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const value of raw) {
    const email = value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) invalidCount++;
    else if (seen.has(email)) duplicateCount++;
    else seen.add(email);
  }
  return { emails: [...seen], invalidCount, duplicateCount };
}
