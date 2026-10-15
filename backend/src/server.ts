import { createApp } from './app';
import { env } from './config/env';
import logger from './config/logger';
import { prisma } from './config/prisma';
import { startScheduler, stopScheduler } from './jobs/scheduler';

async function main() {
  const app = createApp();

  const server = app.listen(env.port, () => {
    logger.info(`3xCode API listening on port ${env.port}`, { env: env.nodeEnv });
  });

  // Background jobs (invoice overdue scans, reminders, cleanup, Discord retries).
  startScheduler();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    stopScheduler();
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    // Force-exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error });
  });
}

main().catch((error) => {
  logger.error('Failed to start server', { error });
  process.exit(1);
});
