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

const log = createLogger('task-service');
const pool = createPool(requireEnv('DATABASE_URL'));
const broker = new Broker(requireEnv('RABBITMQ_URL'), 'task-service', log);
const secret = jwtSecret();

await waitForDb(pool);
await migrate(pool, migrations);
await broker.start();
const stopRelay = startOutboxRelay(pool, broker, log);
listen(buildApp({ pool, broker, log, secret }), portEnv(3002), log, async () => {
  stopRelay();
  await broker.close();
  await pool.end();
});
