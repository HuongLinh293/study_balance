import type { Express } from 'express';
import { createServiceApp, finishApp, requireAuth, type Broker, type Logger, type Pool } from '@studybalance/service-kit';
import { notificationsRouter } from './modules/notifications/routes.js';

export function buildApp(deps: { pool: Pool; broker: Broker; log: Logger; secret: Uint8Array }): Express {
  const app = createServiceApp('notification-service', deps.log, async () => ({
    database: await deps.pool.query('SELECT 1').then(() => true, () => false),
    broker: deps.broker.connected,
  }));
  app.use('/notifications', requireAuth(deps.secret));
  app.use(notificationsRouter(deps.pool));
  finishApp(app, deps.log);
  return app;
}
