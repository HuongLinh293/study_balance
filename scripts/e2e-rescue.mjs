// End-to-end check of the rescue flow and the features around it, against the running stack:
// missed sessions are planned again, step checklist, "starting soon" reminders,
// planned-vs-actual and on-time statistics. Uses a throwaway account.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { addDays, ok, okSynced, sleep, throwaway, today } from './demo/lib.mjs';

const step = async (name, fn) => {
  const started = Date.now();
  await fn();
  console.log(`✔ ${name} (${Date.now() - started}ms)`);
};
const sql = (query) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'mysql', 'sh', '-c', `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -e "${query}"`]).toString();
/** Polls until `check` returns a truthy value (events reach other services asynchronously). */
async function eventually(check, what) {
  for (let i = 0; i < 40; i++) {
    const value = await check();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const { token, userId } = await throwaway('rescue');
const d0 = today();
const nowMinute = (() => {
  const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).split(':').map(Number);
  return h * 60 + m;
})();
const taskId = randomUUID();

await step('setup: open all day, one task with steps', async () => {
  await ok('PATCH', '/api/user/me', {
    token,
    body: { preferences: { sessionMinutes: 50, restMinutes: 5, dailyLimitMinutes: 600, reminders: true, timezone: 'Asia/Ho_Chi_Minh' } },
  });
  const windows = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));
  await ok('PUT', '/api/user/me/availability', { token, body: { windows } });
  await ok('POST', '/api/task/tasks', {
    token,
    body: { id: taskId, title: 'Báo cáo cứu kế hoạch', dueDate: addDays(d0, 5), remainingMinutes: 100, steps: ['Đọc', 'Viết', 'Nộp'] },
  });
});

await step('step checklist: tick, survives an edit of the task', async () => {
  let task = await ok('PATCH', `/api/task/tasks/${taskId}/steps/1`, { token, body: { done: true } });
  assert.deepEqual(task.stepsDone, [false, true, false]);
  task = await ok('PATCH', `/api/task/tasks/${taskId}`, { token, body: { version: task.version, steps: ['Đọc', 'Viết', 'Nộp', 'Sửa'] } });
  assert.deepEqual(task.stepsDone, [false, true, false, false]);
});

await step('a missed session from yesterday no longer blocks re-planning', async () => {
  // Planned two days ago with all of the task's minutes, never studied (the API refuses past dates).
  await okSynced('POST', '/api/planning/plans/generate', { token, body: { taskIds: [taskId] } });
  sql(`INSERT INTO planning_db.study_sessions (id, user_id, task_id, date, start_minute, minutes) VALUES ('${randomUUID()}', '${userId}', '${taskId}', '${addDays(d0, -2)}', 1140, 100)`);
  const proposal = await okSynced('POST', '/api/planning/plans/generate', { token, body: { taskIds: [taskId] } });
  assert.equal(proposal.neededMinutes, 100, 'the missed 100 minutes are needed again');
  assert.equal(proposal.placedMinutes, 100);
  assert.ok(proposal.proposed.every((s) => s.date >= d0));
  assert.ok(proposal.proposed.every((s) => s.date < addDays(d0, 5)), 'deadline day kept as buffer');
});

let soonId;
await step('"starting soon" reminder 15 minutes before a session', async () => {
  if (nowMinute > 1440 - 30) return console.log('  (skipped: too close to midnight)');
  soonId = randomUUID();
  const start = Math.ceil((nowMinute + 6) / 5) * 5;
  await okSynced('POST', '/api/planning/study-sessions', { token, body: { id: soonId, taskId, date: d0, startMinute: start, minutes: 20 } });
  const n = await eventually(async () => {
    const list = await ok('GET', '/api/notification/notifications', { token });
    return list.items.find((i) => i.kind === 'session');
  }, 'session reminder');
  assert.match(n.title, /Sắp đến phiên học: Báo cáo cứu kế hoạch/);
});

await step('planned vs actual and on-time rate in analytics', async () => {
  const id = soonId;
  if (!id) return;
  await ok('POST', `/api/planning/study-sessions/${id}/finish`, { token, body: { actualMinutes: 30 } });
  await ok('PATCH', `/api/task/tasks/${taskId}/progress`, { token, body: { minutes: 30, sessionId: id } });
  const task = await ok('GET', `/api/task/tasks/${taskId}`, { token });
  await ok('PATCH', `/api/task/tasks/${taskId}`, { token, body: { version: task.version, done: true } });
  const summary = await eventually(async () => {
    const s = await ok('GET', '/api/analytics/analytics/summary?period=week', { token });
    return s.estimate.sessions === 1 && s.deadlines.finished === 1 ? s : null;
  }, 'analytics facts');
  assert.deepEqual(summary.estimate, { sessions: 1, plannedMinutes: 20, actualMinutes: 30, ratio: 1.5 });
  assert.deepEqual(summary.deadlines, { finished: 1, onTime: 1, overdue: 0 });
});
console.log('\nrescue flow checks passed');
