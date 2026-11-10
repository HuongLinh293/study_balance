import { Broker, createLogger, createPool, jwtSecret, listen, migrate, portEnv, requireEnv, waitForDb } from '@studybalance/service-kit';
import { buildApp } from './app.js';
import { migrations } from './migrations.js';
import { handlers } from './modules/reminders/handlers.js';
import { startReminderScheduler } from './modules/reminders/generate.js';

const log = createLogger('notification-service');
const pool = createPool(requireEnv('DATABASE_URL'));
const broker = new Broker(requireEnv('RABBITMQ_URL'), 'notification-service', log);
const secret = jwtSecret();

await waitForDb(pool);
await migrate(pool, migrations);
broker.consume(pool, handlers);
await broker.start();
const stopScheduler = startReminderScheduler(pool, log);
listen(buildApp({ pool, broker, log, secret }), portEnv(3004), log, async () => {
  stopScheduler();
  await broker.close();
  await pool.end();
});
