import type { Express } from 'express';
import { createServiceApp, finishApp, requireAuth, type Broker, type Logger, type Pool } from '@studybalance/service-kit';
import { statsRouter } from './modules/stats/routes.js';

export function buildApp(deps: { pool: Pool; broker: Broker; log: Logger; secret: Uint8Array }): Express {
  const app = createServiceApp('analytics-service', deps.log, async () => ({
    database: await deps.pool.query('SELECT 1').then(() => true, () => false),
    broker: deps.broker.connected,
  }));
  app.use('/analytics', requireAuth(deps.secret));
  app.use(statsRouter(deps.pool));
  finishApp(app, deps.log);
  return app;
}
