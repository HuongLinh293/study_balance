// Chapter 4: one REST call with a chosen correlation id, then every service's log lines for it.
import { execFileSync } from 'node:child_process';
import { addDays, call, demoLogin, show, sleep, today } from './lib.mjs';

const cid = `demo-${Date.now().toString(36)}`;
const token = await demoLogin();
const res = await call('POST', '/api/task/tasks', {
  token,
  headers: { 'x-correlation-id': cid },
  body: { title: 'Ôn tập RPC và message queue', dueDate: addDays(today(), 7), remainingMinutes: 60 },
});
show('POST /api/task/tasks', `HTTP ${res.status}, id ${res.body.id}`);
show('X-Correlation-Id', res.headers.get('x-correlation-id'));
show('X-Served-By', res.headers.get('x-served-by'));
await sleep(1500);
console.log(`\n  Log của mọi service chứa ${cid}:`);
execFileSync('node', [new URL('./logs.mjs', import.meta.url).pathname, cid], { stdio: 'inherit' });
