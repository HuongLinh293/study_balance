// Chapter 6: optimistic locking, exactly-once processing of duplicate events,
// and stale previews — on a throwaway account so the demo data stays clean.
import { randomUUID } from 'node:crypto';
import { MGMT, MGMT_AUTH, addDays, bold, call, green, ok, okSynced, red, show, sleep, throwaway, today } from './lib.mjs';

const { token, userId } = await throwaway('consistency');
const d0 = today();
const taskId = randomUUID();
await ok('POST', '/api/task/tasks', { token, body: { id: taskId, title: 'Bài tập Lamport', dueDate: addDays(d0, 5), remainingMinutes: 120 } });

console.log(bold('\n1) Optimistic locking: hai người sửa cùng một bản (version)'));
const v = (await ok('GET', `/api/task/tasks/${taskId}`, { token })).version;
const first = await call('PATCH', `/api/task/tasks/${taskId}`, { token, body: { version: v, title: 'Tab A sửa tiêu đề' } });
show(`Tab A PATCH version=${v}`, green(`${first.status} → version ${first.body.version}`));
const second = await call('PATCH', `/api/task/tasks/${taskId}`, { token, body: { version: v, remainingMinutes: 90 } });
show(`Tab B PATCH version=${v}`, red(`${second.status} ${second.body.error.code}`) + ` (bản hiện tại: version ${second.body.error.details.current.version}, "${second.body.error.details.current.title}")`);

console.log(bold('\n2) Inbox: RabbitMQ giao cùng một sự kiện hai lần'));
const event = {
  eventId: randomUUID(), eventType: 'StudySessionCompleted', schemaVersion: 1, occurredAt: new Date().toISOString(),
  producer: 'planning-service', aggregateId: randomUUID(), aggregateVersion: 2, userId, correlationId: `demo-dup-${Date.now()}`,
  payload: { taskId, date: d0, actualMinutes: 45 },
};
for (let i = 1; i <= 2; i++) {
  const r = await fetch(`${MGMT}/api/exchanges/%2F/studybalance.events/publish`, {
    method: 'POST', headers: { authorization: `Basic ${MGMT_AUTH}`, 'content-type': 'application/json' },
    body: JSON.stringify({ properties: { delivery_mode: 2, message_id: event.eventId }, routing_key: event.eventType, payload: JSON.stringify(event), payload_encoding: 'string' }),
  });
  show(`lần ${i}: publish eventId`, `${event.eventId.slice(0, 8)}… routed=${(await r.json()).routed}`);
}
await sleep(1500);
const summary = await ok('GET', `/api/analytics/analytics/summary?period=week&date=${d0}`, { token });
show('analytics: tổng phút tuần này', green(`${summary.totalMinutes} phút (45 phút, tính đúng một lần)`));
console.log(`  (correlationId: ${event.correlationId})`);

console.log(bold('\n3) Xem trước mô phỏng rồi dữ liệu đổi → không áp dụng lên dữ liệu cũ'));
const tomorrow = addDays(d0, 1);
const session = await okSynced('POST', '/api/planning/study-sessions', { token, body: { taskId, date: tomorrow, startMinute: 14 * 60, minutes: 60 } });
const sim = await ok('POST', '/api/planning/simulations', { token, body: { date: tomorrow, startMinute: 13 * 60, endMinute: 16 * 60, label: 'Họp nhóm' } });
show('mô phỏng bận 13:00–16:00', `${sim.moved.length} phiên sẽ dời, feasible=${sim.feasible}`);
await ok('PATCH', `/api/planning/study-sessions/${session.id}`, { token, body: { startMinute: 15 * 60 } });
show('trong lúc đó', 'phiên học bị dời sang 15:00 ở tab khác');
const apply = await call('POST', `/api/planning/simulations/${sim.id}/apply`, { token });
show('áp dụng bản xem trước', red(`${apply.status} ${apply.body.error.code}`) + ' → phải tạo mô phỏng mới');
