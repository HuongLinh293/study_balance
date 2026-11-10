import { startGoogleSync } from './modules/google-calendar/service.js';
import {
  Broker,
  createLogger,
  createPool,
  jwtSecret,
  listen,
  migrate,
  portEnv,
  requireEnv,
  startOutboxRelay,
  waitForDb,
} from '@studybalance/service-kit';
import { buildApp } from './app.js';
import { migrations } from './migrations.js';

const log = createLogger('user-service');
const pool = createPool(requireEnv('DATABASE_URL'));
const broker = new Broker(requireEnv('RABBITMQ_URL'), 'user-service', log);
const auth = {
  secret: jwtSecret(),
  cookiePath: process.env.REFRESH_COOKIE_PATH ?? '/api/user/auth',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
};

await waitForDb(pool);
await migrate(pool, migrations);
await broker.start();
const stopGoogleSync = startGoogleSync(pool, auth.secret);
const stopRelay = startOutboxRelay(pool, broker, log);
listen(buildApp({ pool, broker, log, auth }), portEnv(3001), log, async () => {
  stopGoogleSync();
  stopRelay();
  await broker.close();
  await pool.end();
});
