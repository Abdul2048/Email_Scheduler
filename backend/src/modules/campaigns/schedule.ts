const HOUR_MS = 60 * 60 * 1000;

export interface ScheduleInput {
  count: number;
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
}

/**
 * Spaces emails `delayMs` apart starting at `startAt`, never putting more than `hourlyLimit`
 * into any one-hour block (blocks are counted from `startAt`).
 */
export function computeSendTimes({ count, startAt, delayMs, hourlyLimit }: ScheduleInput): Date[] {
  const times: Date[] = [];
  let t = startAt.getTime();
  let hourStart = t;
  let countThisHour = 0;

  for (let i = 0; i < count; i++) {
    if (t >= hourStart + HOUR_MS) {
      hourStart += Math.floor((t - hourStart) / HOUR_MS) * HOUR_MS;
      countThisHour = 0;
    }
    if (countThisHour >= hourlyLimit) {
      hourStart += HOUR_MS;
      t = Math.max(t, hourStart);
      countThisHour = 0;
    }
    times.push(new Date(t));
    t += delayMs;
    countThisHour++;
  }
  return times;
}
