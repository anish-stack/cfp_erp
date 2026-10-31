import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export const QUEUES = { NOTIFICATIONS: 'notifications' };

export const notificationsQueue = new Queue(QUEUES.NOTIFICATIONS, { connection: redis, defaultJobOptions });
