#!/usr/bin/env node
// End-to-end smoke test through the gateway against a running stack:
//   docker compose up --build -d && npm run test:e2e
// Env: E2E_BASE_URL (default https://localhost:8443), RABBITMQ_MGMT_URL,
//      RABBITMQ_DEFAULT_USER / RABBITMQ_DEFAULT_PASS for the duplicate-delivery check.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:8443';
const MGMT = process.env.RABBITMQ_MGMT_URL ?? 'http://localhost:15672';
const MGMT_AUTH = Buffer.from(
  `${process.env.RABBITMQ_DEFAULT_USER ?? 'studybalance'}:${process.env.RABBITMQ_DEFAULT_PASS ?? 'local_broker_change_me'}`,
).toString('base64');
const TZ = 'Asia/Ho_Chi_Minh';

const steps = [];
const step = async (name, fn) => {
  const started = Date.now();
  try {
    await fn();
    steps.push(`✔ ${name} (${Date.now() - started}ms)`);
    console.log(steps.at(-1));
  } catch (error) {
    console.error(`✖ ${name}\n`, error);
    process.exit(1);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, { timeoutMs = 15_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(intervalMs);
    }
  }
}
function localNow() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

class Client {
  token = '';
  cookie = '';
  async call(method, path, body, { headers = {} } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie?.startsWith('sb_refresh=')) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  async ok(method, path, body, expected = [200, 201, 204]) {
    const res = await this.call(method, path, body);
    assert.ok(expected.includes(res.status), `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
}

const today = localNow().date;
const tomorrow = addDays(today, 1);
const alice = new Client();
const bob = new Client();
const ids = { subject: randomUUID(), task: randomUUID(), urgent: randomUUID() };
let session;

await step('gateway and services are up', async () => {
  for (const svc of ['user', 'task', 'planning', 'notification', 'analytics']) {
    const res = await fetch(`${BASE}/api/${svc}/health`);
    assert.equal(res.status, 200, svc);
  }
});

await step('register, read and update profile (PreferencesUpdated)', async () => {
  const email = `e2e-${Date.now()}@example.com`;
  const reg = await alice.ok('POST', '/api/user/auth/register', { email, password: 'password-123', name: 'Linh' });
  alice.token = reg.accessToken;
  assert.ok(alice.cookie, 'refresh cookie set');
  const dup = await new Client().call('POST', '/api/user/auth/register', { email, password: 'password-123', name: 'X' });
  assert.equal(dup.status, 409);
  const me = await alice.ok('GET', '/api/user/me');
  assert.equal(me.preferences.dailyLimitMinutes, 240);
  const patched = await alice.ok('PATCH', '/api/user/me', { version: me.version, preferences: { dailyLimitMinutes: 300 } });
  assert.equal(patched.preferences.dailyLimitMinutes, 300);
  const stale = await alice.call('PATCH', '/api/user/me', { version: me.version, note: 'x' });
  assert.equal(stale.status, 409);
  const bobReg = await bob.ok('POST', '/api/user/auth/register', { email: `e2e-b-${Date.now()}@example.com`, password: 'password-123', name: 'Bob' });
  bob.token = bobReg.accessToken;
});

await step('auth is enforced by each service', async () => {
  for (const path of ['/api/task/tasks', '/api/planning/study-sessions?from=2026-01-01&to=2026-01-02', '/api/notification/notifications', '/api/analytics/analytics/summary']) {
    assert.equal((await new Client().call('GET', path)).status, 401, path);
  }
});

await step('create subject and task; retrying create is idempotent', async () => {
  await alice.ok('POST', '/api/task/subjects', { id: ids.subject, name: 'Cơ sở dữ liệu', color: 'blue' });
  const body = { id: ids.task, title: 'Báo cáo CSDL', subjectId: ids.subject, dueDate: addDays(today, 3), remainingMinutes: 120, steps: ['Đọc', 'Viết'] };
  const first = await alice.call('POST', '/api/task/tasks', body);
  const retry = await alice.call('POST', '/api/task/tasks', body);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.version, first.body.version);
  assert.deepEqual(first.body.steps, ['Đọc', 'Viết']);
  assert.equal((await bob.call('GET', `/api/task/tasks/${ids.task}`)).status, 404, 'other users cannot read it');
});

await step('planning receives the task via RabbitMQ and schedules a session', async () => {
  session = await eventually(async () => {
    const res = await alice.call('POST', '/api/planning/study-sessions', { taskId: ids.task, date: tomorrow, startMinute: 9 * 60, minutes: 50 });
    assert.notEqual(res.body?.error?.code, 'TASK_NOT_SYNCED', 'waiting for TaskCreated');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  });
  const overlap = await alice.call('POST', '/api/planning/study-sessions', { taskId: ids.task, date: tomorrow, startMinute: 9 * 60 + 30, minutes: 30 });
  assert.equal(overlap.status, 422);
  assert.equal(overlap.body.error.code, 'OVERLAP');
  const lunch = await alice.call('POST', '/api/planning/study-sessions', { taskId: ids.task, date: tomorrow, startMinute: 11 * 60 + 40, minutes: 30 });
  assert.equal(lunch.body.error.code, 'OUTSIDE_AVAILABILITY', 'default windows keep 12:00–13:10 free');
  const moved = await alice.ok('PATCH', `/api/planning/study-sessions/${session.id}`, { version: session.version, startMinute: 10 * 60 });
  assert.equal(moved.startMinute, 600);
  session = moved;
});

await step('finish session, then record progress explicitly (idempotent per session)', async () => {
  const done = await alice.ok('POST', `/api/planning/study-sessions/${session.id}/finish`, { actualMinutes: 45 });
  assert.equal(done.status, 'done');
  const again = await alice.ok('POST', `/api/planning/study-sessions/${session.id}/finish`, { actualMinutes: 99 });
  assert.equal(again.actualMinutes, 45);
  const p1 = await alice.ok('PATCH', `/api/task/tasks/${ids.task}/progress`, { minutes: 45, sessionId: session.id });
  const p2 = await alice.ok('PATCH', `/api/task/tasks/${ids.task}/progress`, { minutes: 45, sessionId: session.id });
  assert.equal(p1.applied, true);
  assert.equal(p2.applied, false);
  assert.equal(p2.task.remainingMinutes, 75);
  const history = await alice.ok('GET', `/api/task/tasks/${ids.task}/progress`);
  assert.deepEqual(history.items.map((i) => i.sessionId), [session.id]);
});

await step('analytics projects StudySessionCompleted', async () => {
  await eventually(async () => {
    const s = await alice.ok('GET', `/api/analytics/analytics/summary?period=week&date=${tomorrow}`);
    assert.equal(s.totalMinutes, 45);
    assert.deepEqual(s.bySubject, [{ subjectId: ids.subject, minutes: 45 }]);
    assert.equal(s.totalTasks, 1);
  });
});

await step('duplicate event delivery is processed once (inbox)', async () => {
  const fakeSession = randomUUID();
  const event = {
    eventId: randomUUID(),
    eventType: 'StudySessionCompleted',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: 'planning-service',
    aggregateId: fakeSession,
    aggregateVersion: 2,
    userId: (await alice.ok('GET', '/api/user/me')).id,
    correlationId: randomUUID(),
    payload: { taskId: ids.task, date: tomorrow, actualMinutes: 10 },
  };
  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${MGMT}/api/exchanges/%2F/studybalance.events/publish`, {
      method: 'POST',
      headers: { authorization: `Basic ${MGMT_AUTH}`, 'content-type': 'application/json' },
      body: JSON.stringify({ properties: { delivery_mode: 2, message_id: event.eventId }, routing_key: event.eventType, payload: JSON.stringify(event), payload_encoding: 'string' }),
    });
    assert.equal(res.status, 200, 'management publish');
    assert.equal((await res.json()).routed, true);
  }
  await sleep(1500);
  const s = await alice.ok('GET', `/api/analytics/analytics/summary?period=week&date=${tomorrow}`);
  assert.equal(s.totalMinutes, 55, 'counted exactly once');
});

await step('notification service creates and clears deadline reminders', async () => {
  await alice.ok('POST', '/api/task/tasks', { id: ids.urgent, title: 'Nộp bài subnet', dueDate: tomorrow, remainingMinutes: 30 });
  await eventually(async () => {
    const n = await alice.ok('GET', '/api/notification/notifications');
    assert.ok(n.items.some((i) => i.taskId === ids.urgent && i.kind === 'deadline'), 'reminder present');
  });
  await alice.ok('POST', '/api/notification/notifications/read-all');
  assert.equal((await alice.ok('GET', '/api/notification/notifications')).unreadCount, 0);
  const t = await alice.ok('GET', `/api/task/tasks/${ids.urgent}`);
  await alice.ok('PATCH', `/api/task/tasks/${ids.urgent}`, { version: t.version, dueDate: addDays(today, 2) });
  // Deadline moved: the old (read) reminder stays as history, no new unread one is created.
  await sleep(1000);
  assert.equal((await alice.ok('GET', '/api/notification/notifications')).unreadCount, 0);
});

await step('busy simulation across days: preview, stale detection, drop unscheduled', async () => {
  const d2 = addDays(today, 2);
  const s1 = await alice.ok('POST', '/api/planning/study-sessions', { taskId: ids.task, date: d2, startMinute: 9 * 60, minutes: 30 });
  const sim = await alice.ok('POST', '/api/planning/simulations', { date: d2, startMinute: 0, endMinute: 1440, label: 'Về quê' });
  assert.deepEqual(sim.changed.map((c) => c.id), [s1.id]);
  assert.equal(sim.feasible, true);
  assert.equal(sim.moved[0].date, addDays(today, 3), 'moved to the next day before the deadline');
  // Change the plan after previewing: applying the old preview must be refused.
  await alice.ok('PATCH', `/api/planning/study-sessions/${s1.id}`, { minutes: 25 });
  const stale = await alice.call('POST', `/api/planning/simulations/${sim.id}/apply`);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'SIMULATION_STALE');
  // Deadline is today+3: busy on today+3 too leaves no room → unscheduled, then dropped to the backlog.
  const d3 = addDays(today, 3);
  const s2 = await alice.ok('POST', '/api/planning/study-sessions', { taskId: ids.task, date: d3, startMinute: 9 * 60, minutes: 20 });
  const blocked = await alice.ok('POST', '/api/planning/simulations', { date: d3, startMinute: 0, endMinute: 1440, label: '' });
  assert.deepEqual(blocked.unscheduled.map((u) => [u.id, u.reason]), [[s2.id, 'deadline']]);
  const refused = await alice.call('POST', `/api/planning/simulations/${blocked.id}/apply`, {});
  assert.equal(refused.body.error.code, 'SIMULATION_INFEASIBLE');
  await alice.ok('POST', `/api/planning/simulations/${blocked.id}/apply`, { dropUnscheduled: true });
  const list = await alice.ok('GET', `/api/planning/study-sessions?from=${today}&to=${addDays(today, 7)}`);
  assert.ok(!list.items.some((x) => x.id === s2.id), 'dropped session returned to the backlog');
  assert.ok(list.items.some((x) => x.id === s1.id && x.date === d2), 'stale preview changed nothing');
});

await step('custom availability and busy periods drive validation (AvailabilityUpdated)', async () => {
  const d4 = addDays(today, 4);
  const weekday = (new Date(`${d4}T00:00:00Z`).getUTCDay() + 6) % 7;
  const av = await alice.ok('GET', '/api/user/me/availability');
  assert.equal(av.windows.length, 14, 'default windows');
  const evenings = Array.from({ length: 7 }, (_, w) => ({ weekday: w, startMinute: 19 * 60, endMinute: 22 * 60 }));
  const saved = await alice.ok('PUT', '/api/user/me/availability', { version: av.version, windows: evenings });
  const bad = await alice.call('PUT', '/api/user/me/availability', { windows: [{ weekday: 0, startMinute: 600, endMinute: 700 }, { weekday: 0, startMinute: 650, endMinute: 720 }] });
  assert.equal(bad.status, 400, 'overlapping windows rejected');
  await alice.ok('POST', '/api/user/me/busy-periods', { date: d4, startMinute: 19 * 60, endMinute: 20 * 60, label: 'Làm thêm' });
  const longTask = randomUUID();
  await alice.ok('POST', '/api/task/tasks', { id: longTask, title: 'Ôn thi mạng', dueDate: addDays(today, 6), remainingMinutes: 120 });
  await eventually(async () => {
    const morning = await alice.call('POST', '/api/planning/study-sessions', { taskId: longTask, date: d4, startMinute: 9 * 60, minutes: 30 });
    assert.equal(morning.body?.error?.code, 'OUTSIDE_AVAILABILITY', JSON.stringify(morning.body));
    const busy = await alice.call('POST', '/api/planning/study-sessions', { taskId: longTask, date: d4, startMinute: 19 * 60 + 30, minutes: 30 });
    assert.equal(busy.body?.error?.code, 'BUSY_PERIOD', JSON.stringify(busy.body));
  });
  const ok = await alice.ok('POST', '/api/planning/study-sessions', { taskId: longTask, date: d4, startMinute: 20 * 60, minutes: 30 });
  await alice.ok('DELETE', `/api/planning/study-sessions/${ok.id}`);
  assert.ok(saved.version > av.version && weekday >= 0);
  ids.longTask = longTask;
});

await step('generated plan fills evenings before deadlines and reports shortfalls', async () => {
  const proposal = await alice.ok('POST', '/api/planning/plans/generate');
  assert.ok(proposal.proposed.length > 0);
  for (const p of proposal.proposed) assert.ok(p.startMinute >= 19 * 60 && p.startMinute + p.minutes <= 22 * 60, 'inside evening windows');
  const tooBig = randomUUID();
  await alice.ok('POST', '/api/task/tasks', { id: tooBig, title: 'Đồ án quá lớn', dueDate: tomorrow, remainingMinutes: 1000 });
  const withShortfall = await eventually(async () => {
    const p = await alice.ok('POST', '/api/planning/plans/generate');
    assert.ok(p.shortfalls.some((s) => s.taskId === tooBig), 'shortfall for the oversized task');
    return p;
  });
  const missing = withShortfall.shortfalls.find((s) => s.taskId === tooBig);
  assert.ok(missing.missingMinutes > 0 && missing.missingMinutes < 1000);
  assert.equal(withShortfall.placedMinutes + withShortfall.shortfalls.reduce((a, s) => a + s.missingMinutes, 0), withShortfall.neededMinutes);
  const stale = await alice.call('POST', `/api/planning/plans/${proposal.id}/apply`);
  assert.equal(stale.body.error.code, 'PLAN_STALE', 'tasks changed since the first proposal');
  const applied = await alice.ok('POST', `/api/planning/plans/${withShortfall.id}/apply`);
  assert.equal(applied.status, 'applied');
  const list = await alice.ok('GET', `/api/planning/study-sessions?from=${today}&to=${addDays(today, 7)}`);
  for (const p of withShortfall.proposed) assert.ok(list.items.some((x) => x.id === p.id));
  await alice.ok('DELETE', `/api/task/tasks/${tooBig}`);
});

await step('deleting a task cancels its planned sessions via TaskDeleted', async () => {
  // The generated plan already gave this task a session; that is the one to cancel.
  const planned = await eventually(async () => {
    const list = await alice.ok('GET', `/api/planning/study-sessions?from=${today}&to=${addDays(today, 7)}`);
    const found = list.items.find((x) => x.taskId === ids.urgent && x.status === 'planned');
    assert.ok(found, 'planned session for the task');
    return found;
  });
  await alice.ok('DELETE', `/api/task/tasks/${ids.urgent}`);
  await eventually(async () => {
    const list = await alice.ok('GET', `/api/planning/study-sessions?from=${today}&to=${tomorrow}`);
    assert.ok(!list.items.some((x) => x.id === planned.id), 'planned session removed');
  });
  const doneStillThere = await alice.ok('GET', `/api/planning/study-sessions?from=${today}&to=${tomorrow}`);
  assert.ok(doneStillThere.items.some((x) => x.id === session.id), 'finished history kept');
});

await step('change password signs out other sessions', async () => {
  const other = new Client();
  const me = await alice.ok('GET', '/api/user/me');
  const login = await other.ok('POST', '/api/user/auth/login', { email: me.email, password: 'password-123' });
  other.token = login.accessToken;
  const wrong = await alice.call('POST', '/api/user/auth/change-password', { currentPassword: 'nope', newPassword: 'password-456' });
  assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');
  const changed = await alice.ok('POST', '/api/user/auth/change-password', { currentPassword: 'password-123', newPassword: 'password-456' });
  alice.token = changed.accessToken;
  const otherRefresh = await other.call('POST', '/api/user/auth/refresh', undefined, { headers: { 'x-studybalance-client': 'web' } });
  assert.equal(otherRefresh.status, 401, 'other device signed out');
  assert.equal((await new Client().call('POST', '/api/user/auth/login', { email: me.email, password: 'password-123' })).status, 401);
});

await step('refresh token rotation and reuse detection', async () => {
  const noHeader = await alice.call('POST', '/api/user/auth/refresh');
  assert.equal(noHeader.status, 403, 'CSRF header required');
  const oldCookie = alice.cookie;
  const refreshed = await alice.call('POST', '/api/user/auth/refresh', undefined, { headers: { 'x-studybalance-client': 'web' } });
  assert.equal(refreshed.status, 200);
  assert.notEqual(alice.cookie, oldCookie);
  const newCookie = alice.cookie;
  alice.cookie = oldCookie;
  const reuse = await alice.call('POST', '/api/user/auth/refresh', undefined, { headers: { 'x-studybalance-client': 'web' } });
  assert.equal(reuse.status, 401, 'old token rejected');
  alice.cookie = newCookie;
  const afterReuse = await alice.call('POST', '/api/user/auth/refresh', undefined, { headers: { 'x-studybalance-client': 'web' } });
  assert.equal(afterReuse.status, 401, 'whole family revoked after reuse');
});

console.log(`\n${steps.length} steps passed against ${BASE}`);
