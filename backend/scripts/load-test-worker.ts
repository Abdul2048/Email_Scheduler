// A bare worker process for the load test: no startup check, so it never picks up real pending emails.
import { prisma } from '../src/lib/prisma';
import { startEmailWorker } from '../src/queue/emailWorker';

// Open the DB connection first so the cold connect doesn't delay the first sends.
void prisma.$connect().then(() => {
  const worker = startEmailWorker();
  process.on('SIGTERM', () => void worker.close().then(() => process.exit(0)));
});
