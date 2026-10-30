import { createApp } from './app';
import { config } from './config';
import { closePool } from './db';
import { logger } from './logger';
import { startWorker } from './modules/integrations/service';

const app = createApp();
const server = app.listen(config.port, () => logger.info('server_started', { port: config.port, env: config.env }));
const stopWorker = startWorker();

function shutdown(signal: string) {
  logger.info('shutdown', { signal });
  stopWorker();
  server.close(async () => {
    await closePool().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
