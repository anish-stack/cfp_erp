import mongoose from 'mongoose';
import './models/index.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB } from './config/db.js';
import { connectRedis, redis } from './config/redis.js';
import { buildApp } from './app.js';
import { startConfigRefresh } from './services/runtimeConfig.js';

async function main() {
  await connectDB();
  await startConfigRefresh(); // integration keys saved in Admin → Settings override .env
  await connectRedis();
  const server = buildApp().listen(env.PORT, () => logger.info(`API on :${env.PORT} (${env.NODE_ENV})`));

  const shutdown = (sig) => {
    logger.info(`${sig} → shutting down`);
    server.close(async () => {
      await mongoose.disconnect();
      redis.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (e) => logger.error(e, 'unhandledRejection'));
}

main().catch((e) => {
  logger.error(e, 'Boot failed');
  process.exit(1);
});
