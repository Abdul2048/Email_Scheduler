import { setTimeout as sleep } from 'node:timers/promises';
import { DelayedError, Worker, type Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { createRedisConnection, redis } from '../lib/redis';
import { syncEmailToSearch } from '../modules/emails/emailSearch';
import { getTransport } from '../modules/senders/transport';
import { notifyHourlyLimitReached } from '../modules/slack/slack.service';
import { EMAIL_QUEUE, type EmailJobData } from './emailQueue';
import { createRateLimiter, type SlotReservation } from './rateLimiter';

const rateLimiter = createRateLimiter(redis);

const MAX_INLINE_WAIT_MS = 250;

async function markSent(emailId: string, sent: NonNullable<EmailJobData['sent']>): Promise<void> {
  await prisma.email.update({
    where: { id: emailId },
    data: { status: 'SENT', sentAt: new Date(sent.sentAt), previewUrl: sent.previewUrl, error: null },
  });
  syncEmailToSearch(emailId);
}

async function reserveSlot(job: Job<EmailJobData>, senderId: string): Promise<SlotReservation> {
  const reservation = await rateLimiter.reserveSendSlot(senderId);
  await job.updateData({ ...job.data, slot: reservation.slot });
  return reservation;
}

// Short waits sleep in-process; long ones park the job in the delayed set so it doesn't hold a worker slot.
async function waitUntil(job: Job<EmailJobData>, at: number, token?: string): Promise<void> {
  const wait = at - Date.now();
  if (wait > MAX_INLINE_WAIT_MS) {
    await job.moveToDelayed(at, token);
    throw new DelayedError();
  }
  if (wait > 0) await sleep(wait);
}

async function processEmail(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId } = job.data;

  // SMTP already accepted this email on an earlier attempt; only the DB update is left to do.
  if (job.data.sent) {
    await markSent(emailId, job.data.sent);
    return;
  }

  // Reserve before any other await, so jobs running in parallel reserve in queue (FIFO) order.
  let reservation =
    job.data.slot === undefined && job.data.senderId ? await reserveSlot(job, job.data.senderId) : undefined;

  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true, campaign: { select: { body: true } } },
  });
  if (!email || email.status === 'SENT' || email.status === 'FAILED') return;

  // BullMQ runs a job on one worker at a time, so SENDING here means a previous run died mid-send.
  // SMTP may already have accepted it, so fail instead of risking a duplicate.
  if (email.status === 'SENDING') {
    await prisma.email.update({
      where: { id: emailId },
      data: { status: 'FAILED', error: 'Interrupted during send; not retried to avoid a duplicate' },
    });
    syncEmailToSearch(emailId);
    return;
  }

  if (job.data.slot === undefined) reservation = await reserveSlot(job, email.senderId);
  if (reservation && (reservation.slot !== email.scheduledAt.getTime() || reservation.deferred)) {
    await prisma.email.updateMany({
      where: { id: emailId, status: { in: ['SCHEDULED', 'DEFERRED'] } },
      data: { scheduledAt: new Date(reservation.slot), ...(reservation.deferred && { status: 'DEFERRED' }) },
    });
    syncEmailToSearch(emailId);
  }
  if (reservation?.deferred) {
    logger.info(
      { emailId, senderId: email.senderId, until: new Date(reservation.slot).toISOString() },
      'Sender hourly limit reached; email deferred to a later hour',
    );
    void notifyHourlyLimitReached({
      userId: email.userId,
      senderId: email.senderId,
      senderEmail: email.sender.email,
      resumesAt: new Date(reservation.slot),
    });
  }

  await waitUntil(job, job.data.slot!, token);

  const claimed = await prisma.email.updateMany({
    where: { id: emailId, status: { in: ['SCHEDULED', 'DEFERRED'] } },
    data: { status: 'SENDING' },
  });
  if (claimed.count === 0) return;

  // Checked right before SMTP (after the DB claim), so DB latency can't squeeze two sends together.
  // The wait is at most one gap; waiting in-process (not re-queueing) keeps a late job from being starved.
  const turn = { logAs: config.emailTransport === 'dryrun' ? emailId : '' };
  for (let wait; (wait = await rateLimiter.acquireSendTurn(email.senderId, turn)) > 0; ) await sleep(wait);

  const smtpStartedAt = Date.now();
  let info;
  try {
    info = await (await getTransport(email.sender)).sendMail({
      from: email.sender.email,
      to: email.toEmail,
      subject: email.subject,
      text: email.campaign.body,
      messageId: `<${email.id}@reachinbox.local>`,
    });
  } catch (err) {
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await prisma.email.update({
      where: { id: emailId },
      data: { status: isLastAttempt ? 'FAILED' : 'SCHEDULED', error: (err as Error).message },
    });
    syncEmailToSearch(emailId);
    // A retry must reserve a fresh slot, or it could break the sender's gap and hourly limit.
    await job.updateData({ ...job.data, slot: undefined });
    throw err;
  }

  logger.info(
    { emailId, to: email.toEmail, from: email.sender.email, smtpStartedAt, smtpMs: Date.now() - smtpStartedAt },
    'SMTP accepted email',
  );
  const sent = {
    sentAt: Date.now(),
    previewUrl: config.emailTransport === 'ethereal' ? nodemailer.getTestMessageUrl(info) || null : null,
  };
  // Persist the SMTP result in Redis first, so a failed DB write is retried without re-sending.
  await job.updateData({ ...job.data, sent });
  await markSent(emailId, sent);
}

export function startEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE, processEmail, {
    connection: createRedisConnection(),
    prefix: config.queuePrefix,
    concurrency: config.workerConcurrency,
  });
  worker.on('completed', (job) => logger.debug({ emailId: job.data.emailId }, 'Email job completed'));
  worker.on('failed', (job, err) =>
    logger.warn({ emailId: job?.data.emailId, attempt: job?.attemptsMade, err: err.message }, 'Email job failed'),
  );
  worker.on('error', (err) => logger.error({ err }, 'Worker error'));
  return worker;
}
