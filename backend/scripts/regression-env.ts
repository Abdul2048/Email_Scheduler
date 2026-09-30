// Imported first by regression.ts: isolates the run from the dev stack before any app module loads its config.
import 'dotenv/config';

export const REGRESSION_PORT = 4100;

const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/scheduler');
dbUrl.pathname = '/scheduler_regression';

Object.assign(process.env, {
  NODE_ENV: 'production', // JSON logs, which the script reads from the child processes
  LOG_LEVEL: 'info',
  PORT: String(REGRESSION_PORT),
  DATABASE_URL: dbUrl.toString(),
  QUEUE_PREFIX: 'regression',
  ES_INDEX: 'emails_regression',
  EMAIL_TRANSPORT: 'dryrun',
  MIN_DELAY_BETWEEN_SENDS_MS: '1000',
  MAX_EMAILS_PER_HOUR_PER_SENDER: '200',
});
