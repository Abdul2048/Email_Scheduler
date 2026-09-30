import { config } from '../../config';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { HOUR_MS } from '../../queue/rateLimiter';

export async function postToSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
}

const notifyKeyPrefix = (userId: string) => `${config.queuePrefix}:notify:${userId}:`;

/** Saves the user's integration. A (re)connect also clears this hour's "already notified" markers. */
export async function saveSlackIntegration(
  userId: string,
  data: { webhookUrl: string; teamName: string; channelName: string },
): Promise<void> {
  await prisma.slackIntegration.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  const keys = await redis.keys(`${notifyKeyPrefix(userId)}*`);
  if (keys.length) await redis.del(...keys);
}

interface LimitHit {
  userId: string;
  senderId: string;
  senderEmail: string;
  resumesAt: Date;
}

/**
 * Called by the worker when a sender's hourly limit defers one of this user's emails. The integration is read
 * from the DB right now, so connecting or disconnecting takes effect immediately. At most one message per
 * user, sender and hour. Never throws: Slack problems must not affect sending.
 */
export async function notifyHourlyLimitReached({ userId, senderId, senderEmail, resumesAt }: LimitHit): Promise<void> {
  try {
    const integration = await prisma.slackIntegration.findUnique({ where: { userId } });
    if (!integration) return;

    const key = `${notifyKeyPrefix(userId)}${senderId}:${Math.floor(Date.now() / HOUR_MS)}`;
    if ((await redis.set(key, '1', 'EX', 2 * 3600, 'NX')) !== 'OK') return;

    const text =
      `:warning: *Hourly sending limit reached* for sender \`${senderEmail}\` ` +
      `(${config.maxEmailsPerHourPerSender} emails/hour).\n` +
      `The remaining emails are deferred, in order, starting ${resumesAt.toISOString().replace('.000Z', 'Z')}. Nothing is dropped.`;
    try {
      await postToSlack(integration.webhookUrl, text);
    } catch (err) {
      await redis.del(key); // let the next deferral this hour try again
      throw err;
    }
    logger.info({ userId, senderId, channel: integration.channelName }, 'Slack notified: hourly limit reached');
  } catch (err) {
    logger.warn({ err: (err as Error).message, userId, senderId }, 'Slack notification failed (sending is unaffected)');
  }
}
