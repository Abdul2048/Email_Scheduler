import { randomUUID } from 'node:crypto';
import { HttpError } from '../../lib/httpError';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { enqueueEmails } from '../../queue/emailQueue';
import { syncEmailsToSearch } from '../emails/emailSearch';
import { cleanLeads } from './leads';
import { computeSendTimes } from './schedule';

export interface CreateCampaignInput {
  subject: string;
  body: string;
  leads: string[];
  startAt: Date;
  delayBetweenEmailsSec: number;
  hourlyLimit: number;
}

const INSERT_CHUNK = 1000;

export async function createCampaign(userId: string, input: CreateCampaignInput) {
  const { emails: recipients, invalidCount, duplicateCount } = cleanLeads(input.leads);
  if (recipients.length === 0) throw new HttpError(400, 'No valid email addresses in leads');

  const senders = await prisma.sender.findMany({ orderBy: { createdAt: 'asc' } });
  if (senders.length === 0) throw new HttpError(503, 'No senders configured (run npm run seed)');

  const delayMs = Math.round(input.delayBetweenEmailsSec * 1000);
  const sendTimes = computeSendTimes({
    count: recipients.length,
    startAt: input.startAt,
    delayMs,
    hourlyLimit: input.hourlyLimit,
  });

  const campaignId = randomUUID();
  const rows = recipients.map((toEmail, i) => ({
    id: randomUUID(),
    campaignId,
    userId,
    senderId: senders[i % senders.length].id,
    toEmail,
    subject: input.subject,
    scheduledAt: sendTimes[i],
  }));

  await prisma.$transaction(async (tx) => {
    await tx.campaign.create({
      data: {
        id: campaignId,
        userId,
        subject: input.subject,
        body: input.body,
        startAt: input.startAt,
        delayMs,
        hourlyLimit: input.hourlyLimit,
        totalCount: rows.length,
      },
    });
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await tx.email.createMany({ data: rows.slice(i, i + INSERT_CHUNK) });
    }
  }, { timeout: 30_000 });

  try {
    await enqueueEmails(rows);
  } catch (err) {
    // Undo the insert so the client can safely retry. Any jobs already queued find no email and do nothing.
    logger.error({ err, campaignId }, 'Enqueue failed; rolling back campaign');
    await prisma.campaign.delete({ where: { id: campaignId } });
    throw new HttpError(503, 'Scheduling queue is unavailable, please try again');
  }
  void syncEmailsToSearch(rows.map((r) => r.id));

  return { id: campaignId, totalCount: rows.length, invalidCount, duplicateCount };
}
