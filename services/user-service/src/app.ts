import { googleCalendarRouter } from './modules/google-calendar/routes.js';
import type { Express } from 'express';
import { createServiceApp, finishApp, type Broker, type Logger, type Pool } from '@studybalance/service-kit';
import { authRouter, type AuthOptions } from './modules/auth/routes.js';
import { meRouter } from './modules/me/routes.js';
import { availabilityRouter } from './modules/availability/routes.js';

export function buildApp(deps: { pool: Pool; broker: Broker; log: Logger; auth: AuthOptions }): Express {
  const app = createServiceApp('user-service', deps.log, async () => ({
    database: await deps.pool.query('SELECT 1').then(() => true, () => false),
    broker: deps.broker.connected,
  }));
  app.use(authRouter(deps.pool, deps.auth));
  app.use(meRouter(deps.pool, deps.auth.secret));
  app.use(availabilityRouter(deps.pool, deps.auth.secret));
  app.use(googleCalendarRouter(deps.pool, deps.auth.secret));
  finishApp(app, deps.log);
  return app;
}
