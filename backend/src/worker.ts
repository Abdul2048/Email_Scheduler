import { config } from './config';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { onShutdown } from './lib/shutdown';
import { closeTransports, warmUpTransports } from './modules/senders/transport';
import { emailQueue } from './queue/emailQueue';
import { startEmailWorker } from './queue/emailWorker';
import { runStartupCheck } from './queue/startupCheck';

const worker = startEmailWorker();
logger.info({ concurrency: config.workerConcurrency, transport: config.emailTransport }, 'Email worker started');

void runStartupCheck();

const warmUpStart = Date.now();
prisma.sender
  .findMany()
  .then(warmUpTransports)
  .then(() => logger.info({ ms: Date.now() - warmUpStart }, 'SMTP transports warmed up'))
  .catch((err) => logger.warn({ err }, 'SMTP warm-up failed'));

onShutdown(async () => {
  // close() waits for in-flight sends to finish before resolving.
  await worker.close();
  await emailQueue.close();
  closeTransports();
  await prisma.$disconnect();
  await redis.quit();
});
