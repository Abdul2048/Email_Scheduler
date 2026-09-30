import { Queue, type JobsOptions } from 'bullmq';
import { config } from '../config';
import { createRedisConnection } from '../lib/redis';

export const EMAIL_QUEUE = 'email-send';

export interface EmailJobData {
  emailId: string;
  /** Lets the worker reserve a send slot before loading the email (keeps reservations in queue order). */
  senderId?: string;
  /** Send time reserved by the rate limiter (ms); the job never sends before it. */
  slot?: number;
  /** Set once SMTP has accepted the email, so retries never send it again. */
  sent?: { sentAt: number; previewUrl: string | null };
}

export const emailJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: createRedisConnection({ failFast: true }),
  prefix: config.queuePrefix,
});

const ENQUEUE_CHUNK = 500;

// jobId = emailId, so adding the same email twice never creates a second job.
export async function enqueueEmails(emails: { id: string; senderId: string; scheduledAt: Date }[]): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < emails.length; i += ENQUEUE_CHUNK) {
    await emailQueue.addBulk(
      emails.slice(i, i + ENQUEUE_CHUNK).map((email) => ({
        name: 'send',
        data: { emailId: email.id, senderId: email.senderId },
        opts: { ...emailJobOptions, jobId: email.id, delay: Math.max(0, email.scheduledAt.getTime() - now) },
      })),
    );
  }
}
