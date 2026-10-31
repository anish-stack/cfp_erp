import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

export async function connectDB() {
  await mongoose.connect(env.MONGO_URI, { autoIndex: !env.isProd });
  logger.info('MongoDB connected');
  mongoose.connection.on('error', (e) => logger.error(e, 'MongoDB error'));
}

/** Run fn inside a transaction. Requires replica set. */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
