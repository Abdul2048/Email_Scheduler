import { createApp } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { onShutdown } from './lib/shutdown';
import { ensureEmailIndex } from './modules/emails/emailSearch';
import { emailQueue } from './queue/emailQueue';

const server = createApp().listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port} (browser origin ${config.appUrl})`);
  if (!config.google) logger.warn('Google OAuth is not configured; login will return 503');
  if (!config.slack) logger.warn('Slack is not configured; "Connect Slack" will return 503');
});

ensureEmailIndex().catch((err) =>
  logger.warn({ err: (err as Error).message }, 'Elasticsearch unavailable; search is disabled until it is back'),
);

onShutdown(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await emailQueue.close();
  await prisma.$disconnect();
  await redis.quit();
});
