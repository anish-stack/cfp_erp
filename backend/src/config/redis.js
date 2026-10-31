import IORedis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// maxRetriesPerRequest:null required by BullMQ
export const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
redis.on('error', (e) => logger.error({ err: e.message }, 'Redis error'));

export async function connectRedis() {
  if (redis.status === 'wait') await redis.connect();
  logger.info('Redis connected');
}
