// Imported first by load-test.ts: parses CLI flags and sets the env before any app module loads its config.
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1000' },
    workers: { type: 'string', default: '2' },
    concurrency: { type: 'string', default: '5' },
    gap: { type: 'string', default: '100' },
    limit: { type: 'string', default: '200' },
    timeout: { type: 'string', default: '600' },
  },
});

export const args = {
  count: Number(values.count),
  workers: Number(values.workers),
  concurrency: Number(values.concurrency),
  gapMs: Number(values.gap),
  limit: Number(values.limit),
  timeoutMs: Number(values.timeout) * 1000,
};

Object.assign(process.env, {
  QUEUE_PREFIX: 'loadtest',
  ES_INDEX: 'emails_loadtest',
  EMAIL_TRANSPORT: 'dryrun',
  LOG_LEVEL: 'warn',
  WORKER_CONCURRENCY: String(args.concurrency),
  MIN_DELAY_BETWEEN_SENDS_MS: String(args.gapMs),
  MAX_EMAILS_PER_HOUR_PER_SENDER: String(args.limit),
});
