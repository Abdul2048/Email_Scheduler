import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { emailQueue, enqueueEmails } from './emailQueue';

const PAGE_SIZE = 500;
const RETRY_MS = 5000;

/**
 * Runs once when a worker boots (not periodically). Re-adds a job for every pending email whose job is
 * missing from Redis, e.g. after a crash between the DB insert and the enqueue, or a Redis data loss.
 * Safe to run concurrently or repeatedly: jobId = emailId, so existing jobs are never duplicated.
 */
async function requeueMissingJobs(): Promise<{ pending: number; requeued: number }> {
  await emailQueue.waitUntilReady();
  let pending = 0;
  let requeued = 0;
  let cursor: string | undefined;

  for (;;) {
    const emails = await prisma.email.findMany({
      where: { status: { in: ['SCHEDULED', 'DEFERRED'] } },
      select: { id: true, senderId: true, scheduledAt: true },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (emails.length === 0) break;
    cursor = emails[emails.length - 1].id;
    pending += emails.length;

    const states = await Promise.all(emails.map((email) => emailQueue.getJobState(email.id)));
    const missing = emails.filter((_, i) => states[i] === 'unknown');

    if (missing.length > 0) {
      await enqueueEmails(missing);
      requeued += missing.length;
    }
  }
  return { pending, requeued };
}

export async function runStartupCheck(): Promise<void> {
  for (;;) {
    try {
      const { pending, requeued } = await requeueMissingJobs();
      logger.info({ pending, requeued }, 'Startup check complete');
      return;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, `Startup check failed, retrying in ${RETRY_MS / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}
