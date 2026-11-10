import { randomUUID } from 'node:crypto';
import type { AvailabilityWindow } from '@studybalance/event-contracts';
import { addDays, weekdayIndex } from '@studybalance/service-kit';

/**
 * Pure planning rules. One placement engine serves manual timeboxing,
 * plan generation and the busy-day simulation, so all three agree on what
 * "free time" means: the user's weekly windows, minus busy periods, minus
 * time already passed today, minus existing sessions padded by the rest gap.
 */
export const MIN_CHUNK = 15;
/** Search at most this far ahead when placing sessions. */
export const MAX_HORIZON_DAYS = 60;

export interface Availability {
  windows: AvailabilityWindow[];
  busy: { date: string; startMinute: number; endMinute: number }[];
}
export interface Prefs {
  restMinutes: number;
  dailyLimitMinutes: number;
  sessionMinutes: number;
}
export interface TaskInfo {
  taskId: string;
  dueDate: string;
  remainingMinutes: number;
  done: boolean;
  priority?: 'high' | 'normal';
}
export interface Slot {
  id: string;
  taskId: string;
  date: string;
  startMinute: number;
  minutes: number;
  status: 'planned' | 'done';
}
export interface PlanContext {
  availability: Availability;
  prefs: Prefs;
  now: { date: string; minute: number };
  /** Every session that can constrain placement; the engine appends what it places. */
  sessions: Slot[];
}
type Range = [number, number];

export type RuleCode =
  | 'TASK_DONE'
  | 'INVALID_DURATION'
  | 'PAST_DATE'
  | 'PAST_TIME'
  | 'AFTER_DEADLINE'
  | 'BUSY_PERIOD'
  | 'OUTSIDE_AVAILABILITY'
  | 'DAILY_LIMIT'
  | 'OVERLAP';
const messages: Record<RuleCode, string> = {
  TASK_DONE: 'Task is already done',
  INVALID_DURATION: 'Duration must be at least 5 minutes and not exceed the unscheduled remainder',
  PAST_DATE: 'Cannot schedule on a past date',
  PAST_TIME: 'Start time has already passed',
  AFTER_DEADLINE: 'Session is after the task deadline',
  BUSY_PERIOD: 'Overlaps a busy period',
  OUTSIDE_AVAILABILITY: 'Outside your study windows for that day',
  DAILY_LIMIT: 'Session would exceed the daily study limit',
  OVERLAP: 'Overlaps another session or leaves too little rest',
};
export const ruleError = (code: RuleCode) => ({ code, message: messages[code] });

const overlaps = (a: Range, b: Range) => a[0] < b[1] && b[0] < a[1];
function subtract(ranges: Range[], cut: Range): Range[] {
  const out: Range[] = [];
  for (const [s, e] of ranges) {
    if (!overlaps([s, e], cut)) out.push([s, e]);
    else {
      if (s < cut[0]) out.push([s, cut[0]]);
      if (cut[1] < e) out.push([cut[1], e]);
    }
  }
  return out;
}
export const windowsOn = (availability: Availability, date: string): Range[] =>
  availability.windows
    .filter((w) => w.weekday === weekdayIndex(date))
    .map((w) => [w.startMinute, w.endMinute] as Range)
    .sort((a, b) => a[0] - b[0]);
export const busyOn = (availability: Availability, date: string): Range[] =>
  availability.busy.filter((b) => b.date === date).map((b) => [b.startMinute, b.endMinute] as Range);
const sessionsOn = (ctx: PlanContext, date: string) => ctx.sessions.filter((s) => s.date === date);
export const dayLoad = (ctx: PlanContext, date: string) => sessionsOn(ctx, date).reduce((n, s) => n + s.minutes, 0);

/** Where a new session may start and end on `date`. */
export function freeRanges(ctx: PlanContext, date: string): Range[] {
  if (date < ctx.now.date) return [];
  let free = windowsOn(ctx.availability, date);
  for (const busy of busyOn(ctx.availability, date)) free = subtract(free, busy);
  if (date === ctx.now.date) free = subtract(free, [0, ctx.now.minute]);
  const rest = ctx.prefs.restMinutes;
  for (const s of sessionsOn(ctx, date)) free = subtract(free, [s.startMinute - rest, s.startMinute + s.minutes + rest]);
  return free;
}
/** Planned minutes still unallocated for a task. Done sessions already reduced remainingMinutes. */
export function remainingToSchedule(task: TaskInfo, sessions: Slot[]) {
  const allocated = sessions
    .filter((s) => s.taskId === task.taskId && s.status === 'planned')
    .reduce((n, s) => n + s.minutes, 0);
  return Math.max(0, task.remainingMinutes - allocated);
}

/** `ctx.sessions` = the user's other sessions (the one being edited excluded). */
export function validateTimebox(ctx: PlanContext, task: TaskInfo, date: string, startMinute: number, minutes: number) {
  const box: Range = [startMinute, startMinute + minutes];
  if (task.done) return ruleError('TASK_DONE');
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > remainingToSchedule(task, ctx.sessions))
    return ruleError('INVALID_DURATION');
  if (date < ctx.now.date) return ruleError('PAST_DATE');
  if (date === ctx.now.date && startMinute < ctx.now.minute) return ruleError('PAST_TIME');
  if (date > task.dueDate) return ruleError('AFTER_DEADLINE');
  if (busyOn(ctx.availability, date).some((b) => overlaps(b, box))) return ruleError('BUSY_PERIOD');
  if (!windowsOn(ctx.availability, date).some(([s, e]) => s <= box[0] && box[1] <= e))
    return ruleError('OUTSIDE_AVAILABILITY');
  if (dayLoad(ctx, date) + minutes > ctx.prefs.dailyLimitMinutes) return ruleError('DAILY_LIMIT');
  const rest = ctx.prefs.restMinutes;
  if (sessionsOn(ctx, date).some((s) => overlaps(box, [s.startMinute - rest, s.startMinute + s.minutes + rest])))
    return ruleError('OVERLAP');
  return null;
}

/** Earliest start (on a 5-minute grid) for `minutes` on `date`, within the daily limit. */
export function findSlot(ctx: PlanContext, date: string, minutes: number) {
  if (dayLoad(ctx, date) + minutes > ctx.prefs.dailyLimitMinutes) return undefined;
  for (const [s, e] of freeRanges(ctx, date)) {
    const start = Math.ceil(s / 5) * 5;
    if (start + minutes <= e) return start;
  }
  return undefined;
}
function* datesBetween(from: string, to: string) {
  const last = to < addDays(from, MAX_HORIZON_DAYS) ? to : addDays(from, MAX_HORIZON_DAYS);
  for (let d = from; d <= last; d = addDays(d, 1)) yield d;
}

/**
 * Proposes new sessions for every open task, earliest deadline first (high
 * priority breaks ties). A first pass allows at most two sessions per task per
 * day to spread the work; a second pass fills what is still missing. Whatever
 * cannot fit before the deadline is reported as a shortfall, never squeezed in.
 */
export function generatePlan(ctx: PlanContext, tasks: TaskInfo[]) {
  const open = tasks
    .filter((t) => !t.done && t.dueDate >= ctx.now.date && remainingToSchedule(t, ctx.sessions) > 0)
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        Number(b.priority === 'high') - Number(a.priority === 'high') ||
        a.taskId.localeCompare(b.taskId),
    );
  const needed = new Map(open.map((t) => [t.taskId, remainingToSchedule(t, ctx.sessions)]));
  const proposed: Slot[] = [];
  for (const perDayCap of [2, Infinity]) {
    for (const task of open) {
      for (const date of datesBetween(ctx.now.date, task.dueDate)) {
        let placedToday = proposed.filter((p) => p.taskId === task.taskId && p.date === date).length;
        while (remainingToSchedule(task, ctx.sessions) > 0 && placedToday < perDayCap) {
          const need = remainingToSchedule(task, ctx.sessions);
          const limitLeft = ctx.prefs.dailyLimitMinutes - dayLoad(ctx, date);
          let placed = false;
          for (const [s, e] of freeRanges(ctx, date)) {
            const start = Math.ceil(s / 5) * 5;
            const size = Math.min(ctx.prefs.sessionMinutes, need, e - start, limitLeft);
            if (size < Math.min(need, MIN_CHUNK) || size < 5) continue;
            const slot: Slot = { id: randomUUID(), taskId: task.taskId, date, startMinute: start, minutes: size, status: 'planned' };
            ctx.sessions.push(slot);
            proposed.push(slot);
            placedToday++;
            placed = true;
            break;
          }
          if (!placed) break;
        }
      }
    }
  }
  const shortfalls = open
    .map((t) => ({
      taskId: t.taskId,
      dueDate: t.dueDate,
      neededMinutes: needed.get(t.taskId)!,
      missingMinutes: remainingToSchedule(t, ctx.sessions),
    }))
    .filter((s) => s.missingMinutes > 0);
  return {
    proposed,
    shortfalls,
    neededMinutes: [...needed.values()].reduce((a, b) => a + b, 0),
    placedMinutes: proposed.reduce((a, p) => a + p.minutes, 0),
  };
}

/**
 * Busy-period preview: planned sessions overlapping the busy range move, whole,
 * to the earliest free slot from that day up to their deadline (across days).
 * Sessions that cannot be placed are reported with the reason, never dropped silently.
 */
export function simulateBusy(
  ctx: PlanContext,
  busy: { date: string; startMinute: number; endMinute: number },
  tasks: Map<string, TaskInfo>,
) {
  const range: Range = [busy.startMinute, busy.endMinute];
  const changed = ctx.sessions
    .filter(
      (s) =>
        s.date === busy.date &&
        s.status === 'planned' &&
        !tasks.get(s.taskId)?.done &&
        overlaps([s.startMinute, s.startMinute + s.minutes], range),
    )
    .sort(
      (a, b) =>
        (tasks.get(a.taskId)?.dueDate ?? '').localeCompare(tasks.get(b.taskId)?.dueDate ?? '') || a.startMinute - b.startMinute,
    );
  ctx.sessions = ctx.sessions.filter((s) => !changed.includes(s));
  ctx.availability = { ...ctx.availability, busy: [...ctx.availability.busy, busy] };
  const moved: Slot[] = [];
  const unscheduled: (Slot & { reason: 'deadline' | 'no_time' })[] = [];
  for (const s of changed) {
    const task = tasks.get(s.taskId);
    let next: Slot | undefined;
    if (task) {
      for (const date of datesBetween(busy.date, task.dueDate)) {
        const start = findSlot(ctx, date, s.minutes);
        if (start !== undefined) {
          next = { ...s, date, startMinute: start };
          break;
        }
      }
    }
    if (next) {
      ctx.sessions.push(next);
      moved.push(next);
    } else {
      unscheduled.push({ ...s, reason: !task || task.dueDate <= busy.date ? 'deadline' : 'no_time' });
    }
  }
  return { changed, moved, unscheduled };
}
