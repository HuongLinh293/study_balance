#!/usr/bin/env node
// Fault test: the broker goes down while a user keeps working.
// Requires the Compose stack and the docker CLI:  npm run test:outage
// Expected: writes still succeed (stored with their outbox rows), and once
// RabbitMQ is back the relay publishes them and Planning catches up.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const compose = (...args) => execFileSync('docker', ['compose', ...args], { stdio: 'pipe' }).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, token, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const tomorrow = (() => {
  const d = new Date(Date.now() + 7 * 3600_000 + 86_400_000); // Asia/Ho_Chi_Minh
  return d.toISOString().slice(0, 10);
})();

const reg = await call('POST', '/api/user/auth/register', null, {
  email: `outage-${Date.now()}@example.com`,
  password: 'password-123',
  name: 'Outage',
});
assert.equal(reg.status, 201);
const token = reg.body.accessToken;

console.log('• stopping rabbitmq');
compose('stop', 'rabbitmq');
try {
  const taskId = randomUUID();
  const created = await call('POST', '/api/task/tasks', token, {
    id: taskId,
    title: 'Viết trong lúc broker tắt',
    dueDate: tomorrow,
    remainingMinutes: 60,
  });
  assert.equal(created.status, 201, 'task-service accepts writes without the broker');
  console.log('✔ task created while broker is down (event kept in outbox)');
  await sleep(2000);
  const early = await call('POST', '/api/planning/study-sessions', token, { taskId, date: tomorrow, startMinute: 9 * 60, minutes: 30 });
  assert.equal(early.body?.error?.code, 'TASK_NOT_SYNCED', 'planning has not seen the task yet');
  console.log('✔ planning reports TASK_NOT_SYNCED instead of guessing');

  console.log('• starting rabbitmq');
  compose('start', 'rabbitmq');
  const deadline = Date.now() + 90_000;
  for (;;) {
    const res = await call('POST', '/api/planning/study-sessions', token, { taskId, date: tomorrow, startMinute: 9 * 60, minutes: 30 });
    if (res.status === 201) break;
    assert.ok(Date.now() < deadline, `planning never caught up: ${JSON.stringify(res.body)}`);
    await sleep(1000);
  }
  console.log('✔ after recovery the outbox relay published TaskCreated and planning caught up');
} finally {
  compose('start', 'rabbitmq');
}
