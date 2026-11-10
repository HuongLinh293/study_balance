import { Broker, createLogger, createPool, jwtSecret, listen, migrate, portEnv, requireEnv, waitForDb } from '@studybalance/service-kit';
import { buildApp } from './app.js';
import { migrations } from './migrations.js';
import { handlers } from './modules/stats/handlers.js';

const log = createLogger('analytics-service');
const pool = createPool(requireEnv('DATABASE_URL'));
const broker = new Broker(requireEnv('RABBITMQ_URL'), 'analytics-service', log);
const secret = jwtSecret();

await waitForDb(pool);
await migrate(pool, migrations);
broker.consume(pool, handlers);
await broker.start();
listen(buildApp({ pool, broker, log, secret }), portEnv(3005), log, async () => {
  await broker.close();
  await pool.end();
});
