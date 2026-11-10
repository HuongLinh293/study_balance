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
