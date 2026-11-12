// A large planning input (hundreds of tasks over 60 days) for engine and worker tests.
import { randomUUID } from 'node:crypto';
import type { PlanContext, TaskInfo } from '../../src/modules/sessions/rules.js';
import { addDays } from '@studybalance/service-kit';
export function bigInput(taskCount: number, today = '2026-11-12') {
  const windows = [];
  for (let d = 0; d < 7; d++) windows.push({ weekday: d, startMinute: 480, endMinute: 720 }, { weekday: d, startMinute: 790, endMinute: 1320 });
  const ctx: PlanContext = {
    availability: { windows, busy: [] },
    prefs: { restMinutes: 10, dailyLimitMinutes: 600, sessionMinutes: 25 },
    now: { date: today, minute: 0 },
    sessions: [],
  };
  const tasks: TaskInfo[] = Array.from({ length: taskCount }, (_, i) => ({
    taskId: randomUUID(), dueDate: addDays(today, 5 + (i % 55)), remainingMinutes: 120 + (i % 7) * 60, done: false, priority: i % 5 ? 'normal' : 'high',
  }));
  return { ctx, tasks };
}
