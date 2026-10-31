import { Worker, UnrecoverableError } from 'bullmq';
import '../models/index.js';
import { connectRedis, redis } from '../config/redis.js';
import { connectDB } from '../config/db.js';
import { logger } from '../config/logger.js';
import { QUEUES } from './queues.js';
import { handlers, registerRepeatables } from './handlers.js';
import { startConfigRefresh } from '../services/runtimeConfig.js';

async function main() {
  await connectDB();
  await startConfigRefresh(); // integration keys saved in Admin → Settings override .env
  await connectRedis();
  await registerRepeatables();

  const worker = new Worker(
    QUEUES.NOTIFICATIONS,
    async (job) => {
      const h = handlers[job.name];
      if (!h) throw new Error(`No handler for ${job.name}`);
      try {
        return await h(job.data);
      } catch (e) {
        // bad API key / no balance / invalid number → don't retry
        if (e.permanent) throw new UnrecoverableError(e.message);
        throw e;
      }
    },
    { connection: redis, concurrency: 10 }
  );

  worker.on('completed', (job) => logger.debug({ id: job.id, name: job.name }, 'job done'));
  worker.on('failed', (job, err) => logger.error({ id: job?.id, name: job?.name, attempts: job?.attemptsMade, err: err.message }, 'job failed'));

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  logger.info('Worker started');
}

main().catch((e) => {
  logger.error(e, 'Worker boot failed');
  process.exit(1);
});
