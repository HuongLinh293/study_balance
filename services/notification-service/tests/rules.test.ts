import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remindersFor } from '../src/modules/reminders/rules.js';

test('deadline reminders cover overdue, today and tomorrow, with stable dedupe keys', () => {
  const list = remindersFor(
    '2026-10-24',
    [
      { taskId: 'a', title: 'Báo cáo', dueDate: '2026-10-25', remainingMinutes: 90 },
      { taskId: 'b', title: 'Subnet', dueDate: '2026-10-23', remainingMinutes: 30 },
      { taskId: 'c', title: 'Đồ án', dueDate: '2026-10-30', remainingMinutes: 30 },
    ],
    2,
  );
  assert.deepEqual(
    list.map((r) => r.dedupeKey),
    ['due:b:2026-10-23:2026-10-24', 'due:a:2026-10-25:2026-10-24', 'plan:2026-10-24'],
  );
  assert.match(list[0].title, /quá hạn/);
  assert.match(list[1].body, /ngày mai, 25\/10.*1h 30p/);
  assert.match(list[2].title, /2 phiên/);
});
test('no reminders for an empty day', () => {
  assert.deepEqual(remindersFor('2026-10-24', [], 0), []);
});
test('a session reminder shows from 15 minutes before the start until the end', () => {
  const sessions = [{ sessionId: 's1', title: 'Lab Wireshark', startMinute: 1170, minutes: 50 }];
  assert.deepEqual(remindersFor('2026-10-24', [], 1, sessions, 1150).map((r) => r.kind), ['plan']);
  const soon = remindersFor('2026-10-24', [], 1, sessions, 1160);
  assert.equal(soon[0].kind, 'session');
  assert.match(soon[0].title, /Sắp đến phiên học: Lab Wireshark/);
  assert.equal(soon[0].body, '19:30 – 20:20, 50 phút.');
  assert.match(remindersFor('2026-10-24', [], 1, sessions, 1180)[0].title, /Đang trong giờ học/);
  assert.equal(remindersFor('2026-10-24', [], 1, sessions, 1220)[0].kind, 'plan');
});
