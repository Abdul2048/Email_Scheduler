import 'dotenv/config';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.url().default('https://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  ELASTICSEARCH_URL: z.url().default('http://localhost:9200'),
  ES_INDEX: z.string().min(1).default('emails'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  SLACK_CLIENT_ID: optional,
  SLACK_CLIENT_SECRET: optional,

  QUEUE_PREFIX: z.string().min(1).default('bull'),

  SENDER_COUNT: z.coerce.number().int().min(1).default(3),
  EMAIL_TRANSPORT: z.enum(['ethereal', 'dryrun']).default('ethereal'),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  MIN_DELAY_BETWEEN_SENDS_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(200),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  appUrl: env.APP_URL.replace(/\/$/, ''),
  logLevel: env.LOG_LEVEL,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  elasticsearchUrl: env.ELASTICSEARCH_URL,
  esIndex: env.ES_INDEX,
  sessionSecret: env.SESSION_SECRET,
  google:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined,
  slack:
    env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET
      ? { clientId: env.SLACK_CLIENT_ID, clientSecret: env.SLACK_CLIENT_SECRET }
      : undefined,
  queuePrefix: env.QUEUE_PREFIX,
  senderCount: env.SENDER_COUNT,
  emailTransport: env.EMAIL_TRANSPORT,
  workerConcurrency: env.WORKER_CONCURRENCY,
  minDelayBetweenSendsMs: env.MIN_DELAY_BETWEEN_SENDS_MS,
  maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
} as const;
