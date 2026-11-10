import type { Express } from 'express';
import { createServiceApp, finishApp, requireAuth, type Broker, type Logger, type Pool } from '@studybalance/service-kit';
import { sessionsRouter } from './modules/sessions/routes.js';
import { simulationsRouter } from './modules/simulations/routes.js';
import { plansRouter } from './modules/plans/routes.js';

export function buildApp(deps: { pool: Pool; broker: Broker; log: Logger; secret: Uint8Array }): Express {
  const app = createServiceApp('planning-service', deps.log, async () => ({
    database: await deps.pool.query('SELECT 1').then(() => true, () => false),
    broker: deps.broker.connected,
  }));
  app.use(['/study-sessions', '/simulations', '/plans'], requireAuth(deps.secret));
  app.use(sessionsRouter(deps.pool));
  app.use(simulationsRouter(deps.pool));
  app.use(plansRouter(deps.pool));
  finishApp(app, deps.log);
  return app;
}
