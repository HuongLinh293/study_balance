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
import { handlers } from './modules/projections/handlers.js';
import { planner } from './modules/planner/index.js';

const log = createLogger('planning-service');
const pool = createPool(requireEnv('DATABASE_URL'));
const broker = new Broker(requireEnv('RABBITMQ_URL'), 'planning-service', log);
const secret = jwtSecret();

await waitForDb(pool);
await migrate(pool, migrations);
broker.consume(pool, handlers);
await broker.start();
const stopRelay = startOutboxRelay(pool, broker, log);
listen(buildApp({ pool, broker, log, secret }), portEnv(3003), log, async () => {
  stopRelay();
  await planner.close();
  await broker.close();
  await pool.end();
});
