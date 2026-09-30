import { logger } from './logger';

export function onShutdown(cleanup: () => Promise<void>): void {
  let shuttingDown = false;
  const handler = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    try {
      await cleanup();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}
