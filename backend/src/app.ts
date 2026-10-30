import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { config } from './config';
import { pool } from './db';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authenticate } from './middleware/auth';
import { authRouter, usersRouter } from './modules/users/routes';
import { catalogRouter } from './modules/catalog/routes';
import { inventoryRouter } from './modules/inventory/routes';
import { ordersRouter } from './modules/orders/routes';
import { suppliersRouter } from './modules/suppliers/routes';
import { scanRouter } from './modules/scan/routes';
import { reportsRouter } from './modules/reports/routes';
import { integrationsPublicRouter, integrationsRouter } from './modules/integrations/routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const start = Date.now();
    res.on('finish', () => logger.info('request', { requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start, userId: req.user?.id }));
    next();
  });
  // rawBody is retained so inbound integration webhooks can verify HMAC signatures.
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  if (config.rateLimit.enabled) {
    app.use('/api/', rateLimit({ windowMs: 60_000, limit: config.rateLimit.perMinute, standardHeaders: true, legacyHeaders: false }));
  }

  // Liveness: process is up. Readiness: database reachable.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const v1 = express.Router();
  // Public: login, and HMAC-authenticated inbound integration webhooks.
  v1.use('/auth', authRouter);
  v1.use(integrationsPublicRouter);
  // Single authentication boundary: everything below requires a valid JWT.
  v1.use(authenticate);
  v1.use(usersRouter);
  v1.use(catalogRouter);
  v1.use(inventoryRouter);
  v1.use(ordersRouter);
  v1.use(suppliersRouter);
  v1.use(scanRouter);
  v1.use(reportsRouter);
  v1.use(integrationsRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
