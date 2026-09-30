import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

/**
 * Workers need maxRetriesPerRequest: null (BullMQ requirement) so they wait out Redis outages.
 * Producers used by HTTP requests pass failFast so a request errors instead of hanging while Redis is down.
 */
export function createRedisConnection({ failFast = false } = {}): IORedis {
  const connection = new IORedis(
    config.redisUrl,
    failFast ? { maxRetriesPerRequest: 1, enableOfflineQueue: false } : { maxRetriesPerRequest: null },
  );
  let down = false;
  connection.on('error', (err) => {
    if (down) return;
    down = true;
    logger.warn({ err: err.message }, 'Redis connection lost (retrying)');
  });
  connection.on('ready', () => {
    if (!down) return;
    down = false;
    logger.info('Redis connection restored');
  });
  return connection;
}

export const redis = createRedisConnection();
