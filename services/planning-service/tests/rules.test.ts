import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  freeRanges,
  generatePlan,
  remainingToSchedule,
  simulateBusy,
  validateTimebox,
  type Availability,
  type PlanContext,
  type Slot,
  type TaskInfo,
} from '../src/modules/sessions/rules.js';

// Saturday 24/10/2026 (weekday 5), 09:00.
const TODAY = '2026-10-24';
const TOMORROW = '2026-10-25';
const everyDay = (ranges: [number, number][]) =>
  Array.from({ length: 7 }, (_, weekday) => ranges.map(([startMinute, endMinute]) => ({ weekday, startMinute, endMinute }))).flat();
const defaultAvailability: Availability = { windows: everyDay([[480, 720], [790, 1080]]), busy: [] };
const task = (taskId: string, dueDate: string, remainingMinutes: number, extra: Partial<TaskInfo> = {}): TaskInfo => ({
  taskId,
  dueDate,
  remainingMinutes,
  done: false,
  ...extra,
});
const slot = (id: string, taskId: string, date: string, startMinute: number, minutes: number, status: Slot['status'] = 'planned'): Slot => ({
  id,
  taskId,
  date,
  startMinute,
  minutes,
  status,
});
const ctx = (sessions: Slot[] = [], over: Partial<PlanContext> = {}): PlanContext => ({
  availability: defaultAvailability,
  prefs: { restMinutes: 10, dailyLimitMinutes: 240, sessionMinutes: 50 },
  now: { date: TODAY, minute: 540 },
  sessions: sessions.map((s) => ({ ...s })),
  ...over,
});
const sessions = [
  slot('s0', 'done-task', TODAY, 480, 30, 'done'),
  slot('s1', 't1', TODAY, 540, 50),
  slot('s3', 't2', TODAY, 840, 50),
  slot('s4', 't1', TOMORROW, 540, 50),
];

test('free ranges respect windows, busy periods, now and rest around sessions', () => {
  const c = ctx(sessions, {
    availability: { ...defaultAvailability, busy: [{ date: TODAY, startMinute: 960, endMinute: 1020 }] },
  });
  assert.deepEqual(freeRanges(c, TODAY), [
    [600, 720],
    [790, 830],
    [900, 960],
    [1020, 1080],
  ]);
  assert.deepEqual(freeRanges(c, '2026-10-23'), []);
});
test('timebox rules report their own codes', () => {
  const c = ctx(sessions, {
    availability: { windows: defaultAvailability.windows, busy: [{ date: TODAY, startMinute: 1020, endMinute: 1080 }] },
  });
  const fresh = task('n', '2026-10-26', 60);
  const code = (date: string, start: number, minutes: number, t = fresh) => validateTimebox(c, t, date, start, minutes)?.code ?? null;
  assert.equal(code(TODAY, 960, 50), null);
  assert.equal(code(TODAY, 550, 50), 'OVERLAP');
  assert.equal(code(TODAY, 700, 30), 'OUTSIDE_AVAILABILITY');
  assert.equal(code(TODAY, 1030, 30), 'BUSY_PERIOD');
  assert.equal(code(TODAY, 500, 30), 'PAST_TIME');
  assert.equal(code('2026-10-23', 900, 30), 'PAST_DATE');
  assert.equal(code('2026-10-27', 900, 30), 'AFTER_DEADLINE');
  assert.equal(code(TODAY, 960, 70), 'INVALID_DURATION');
  assert.equal(code(TODAY, 960, 30, { ...fresh, done: true }), 'TASK_DONE');
  assert.equal(code(TODAY, 900, 50, task('big', TODAY, 300)), null);
  const full = ctx([...sessions, slot('x', 'z', TODAY, 610, 100)]);
  assert.equal(validateTimebox(full, task('big', TODAY, 300), TODAY, 960, 50)?.code, 'DAILY_LIMIT');
});
test('custom windows replace the fixed 08:00–18:00 day', () => {
  const evenings = ctx([], { availability: { windows: everyDay([[1140, 1320]]), busy: [] } });
  const t = task('n', TOMORROW, 60);
  assert.equal(validateTimebox(evenings, t, TODAY, 600, 30)?.code, 'OUTSIDE_AVAILABILITY');
  assert.equal(validateTimebox(evenings, t, TODAY, 1200, 60), null);
});
test('generated plan meets deadlines first, splits by session length and spreads days', () => {
  const c = ctx([]);
  const result = generatePlan(c, [task('later', '2026-10-27', 100), task('soon', TOMORROW, 120, { priority: 'high' })]);
  assert.deepEqual(result.shortfalls, []);
  const soon = result.proposed.filter((p) => p.taskId === 'soon');
  assert.deepEqual(soon.map((p) => p.minutes), [50, 50, 20]);
  assert.ok(soon.every((p) => p.date <= TOMORROW));
  assert.ok(soon.filter((p) => p.date === TODAY).length <= 2, 'first pass caps sessions per task per day');
  assert.equal(result.placedMinutes, 220);
  for (const p of result.proposed) assert.equal(validateTimebox({ ...c, sessions: c.sessions.filter((s) => s !== p) }, task(p.taskId, '2026-10-27', 999), p.date, p.startMinute, p.minutes), null);
});
test('a missed session no longer reserves time: its work is planned again', () => {
  // Yesterday's planned session was never finished.
  const c = ctx([slot('missed', 't1', '2026-10-23', 540, 60)]);
  const result = generatePlan(c, [task('t1', '2026-10-27', 60)]);
  assert.equal(result.neededMinutes, 60);
  assert.equal(result.placedMinutes, 60);
  assert.ok(result.proposed.every((p) => p.date >= TODAY));
});
test('work aims to finish a day before the deadline when that costs nothing', () => {
  const result = generatePlan(ctx([]), [task('t1', '2026-10-27', 200)]);
  assert.deepEqual(result.shortfalls, []);
  assert.ok(result.proposed.every((p) => p.date < '2026-10-27'), 'deadline day kept free');
});
test('the buffer day is used when the work does not fit otherwise', () => {
  // 240 min/day: today (from 09:00) + tomorrow cannot hold 700 minutes, the deadline day must be used.
  const result = generatePlan(ctx([]), [task('t1', '2026-10-26', 700)]);
  assert.deepEqual(result.shortfalls, []);
  assert.ok(result.proposed.some((p) => p.date === '2026-10-26'));
});
test('the buffer never moves a shortfall onto a more urgent task', () => {
  // Demo week (Thursday 13:43): evenings on weekdays, mornings at weekends, 150 min/day.
  const weekly = Array.from({ length: 7 }, (_, weekday) =>
    weekday < 5 ? { weekday, startMinute: 1110, endMinute: 1290 } : { weekday, startMinute: 480, endMinute: 690 },
  );
  const c = ctx([], {
    now: { date: '2026-11-12', minute: 823 },
    availability: { windows: weekly, busy: [] },
    prefs: { restMinutes: 10, dailyLimitMinutes: 150, sessionMinutes: 50 },
  });
  const due = (n: number) => `2026-11-${String(12 + n).padStart(2, '0')}`;
  const result = generatePlan(c, [
    task('subnet', due(1), 120, { priority: 'high' }),
    task('read', due(2), 60),
    task('report', due(3), 240, { priority: 'high' }),
    task('lamport', due(4), 90),
    task('exam', due(5), 180),
    task('lab', due(6), 90),
    task('project', due(12), 1500, { priority: 'high' }),
  ]);
  assert.deepEqual(result.shortfalls.map((s) => s.taskId), ['project'], 'only the large project lacks time');
});
test('a plan that cannot fit reports the shortfall instead of overfilling', () => {
  // 7 hours available before the deadline (spec example), 9 hours needed → 2 hours missing.
  const c = ctx([], {
    now: { date: TODAY, minute: 0 },
    prefs: { restMinutes: 0, dailyLimitMinutes: 600, sessionMinutes: 60 },
    availability: { windows: everyDay([[480, 690]]), busy: [] },
  });
  const result = generatePlan(c, [task('net', TOMORROW, 120), task('db', TOMORROW, 240), task('exam', TOMORROW, 180)]);
  assert.equal(result.neededMinutes, 540);
  assert.equal(result.placedMinutes, 420);
  assert.equal(result.shortfalls.reduce((a, s) => a + s.missingMinutes, 0), 120);
});
test('busy simulation moves sessions across days up to the deadline, and explains what does not fit', () => {
  const c = ctx(sessions, { prefs: { restMinutes: 10, dailyLimitMinutes: 120, sessionMinutes: 50 } });
  const tasks = new Map([
    ['t1', task('t1', '2026-10-26', 150)],
    ['t2', task('t2', TODAY, 50)],
  ]);
  const before = JSON.stringify(sessions);
  const result = simulateBusy(c, { date: TODAY, startMinute: 0, endMinute: 1440 }, tasks);
  assert.equal(JSON.stringify(sessions), before, 'input not mutated');
  assert.deepEqual(result.changed.map((s) => s.id), ['s3', 's1']);
  assert.deepEqual(result.unscheduled.map((s) => [s.id, s.reason]), [['s3', 'deadline']]);
  assert.equal(result.moved[0].id, 's1');
  assert.equal(result.moved[0].date, TOMORROW);
  assert.equal(remainingToSchedule(tasks.get('t1')!, c.sessions), 50);
  const tight = simulateBusy(
    ctx(sessions, { prefs: { restMinutes: 10, dailyLimitMinutes: 50, sessionMinutes: 50 } }),
    { date: TODAY, startMinute: 0, endMinute: 1440 },
    new Map([['t1', task('t1', '2026-10-26', 150)], ['t2', task('t2', TODAY, 50)]]),
  );
  // Tomorrow is full (limit 50), so s1 moves two days ahead.
  assert.equal(tight.moved.find((m) => m.id === 's1')?.date, '2026-10-26');
});
