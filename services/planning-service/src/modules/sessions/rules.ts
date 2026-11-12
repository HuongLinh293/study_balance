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
export const freeRanges = (ctx: PlanContext, date: string) => freeAmong(ctx, date, sessionsOn(ctx, date));
function freeAmong(ctx: PlanContext, date: string, sessions: Slot[]): Range[] {
  if (date < ctx.now.date) return [];
  let free = windowsOn(ctx.availability, date);
  for (const busy of busyOn(ctx.availability, date)) free = subtract(free, busy);
  if (date === ctx.now.date) free = subtract(free, [0, ctx.now.minute]);
  const rest = ctx.prefs.restMinutes;
  for (const s of sessions) free = subtract(free, [s.startMinute - rest, s.startMinute + s.minutes + rest]);
  return free;
}
/**
 * A planned session on a day that has passed was missed: it no longer reserves
 * time for its task, so the task's remainder can be planned again.
 */
export const isMissed = (s: Slot, today: string) => s.status === 'planned' && s.date < today;
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
 * Per-date and per-task lookups over the sessions being planned, so each
 * placement costs O(sessions that day) instead of a scan of every session.
 */
class PlanIndex {
  private byDate = new Map<string, Slot[]>();
  private load = new Map<string, number>();
  private allocated = new Map<string, number>();
  /** Free ranges per date; only adding a session on that date changes them. */
  private freeCache = new Map<string, Range[]>();
  constructor(private ctx: PlanContext) {
    for (const s of ctx.sessions) this.index(s);
  }
  private index(s: Slot) {
    const day = this.byDate.get(s.date);
    if (day) day.push(s);
    else this.byDate.set(s.date, [s]);
    this.load.set(s.date, (this.load.get(s.date) ?? 0) + s.minutes);
    if (s.status === 'planned') this.allocated.set(s.taskId, (this.allocated.get(s.taskId) ?? 0) + s.minutes);
  }
  add(s: Slot) {
    this.ctx.sessions.push(s);
    this.index(s);
    this.freeCache.delete(s.date);
  }
  remaining = (t: TaskInfo) => Math.max(0, t.remainingMinutes - (this.allocated.get(t.taskId) ?? 0));
  dayLoad = (date: string) => this.load.get(date) ?? 0;
  free = (date: string) => {
    let free = this.freeCache.get(date);
    if (!free) {
      free = this.dayLoad(date) >= this.ctx.prefs.dailyLimitMinutes ? [] : freeAmong(this.ctx, date, this.byDate.get(date) ?? []);
      this.freeCache.set(date, free);
    }
    return free;
  };
}

/**
 * Greedy placement, earliest deadline first (high priority breaks ties). A first
 * pass allows at most two sessions per task per day to spread the work; later
 * passes fill what is still missing. With `bufferDays`, each pass first aims to
 * finish that many days before the deadline, then may use those days: spreading
 * work over days matters more than keeping the buffer.
 */
function place(ctx: PlanContext, open: TaskInfo[], bufferDays: number) {
  const idx = new PlanIndex(ctx);
  const proposed: Slot[] = [];
  const perDay = new Map<string, number>();
  const passes = bufferDays
    ? [
        { cap: 2, buffer: bufferDays },
        { cap: 2, buffer: 0 },
        { cap: Infinity, buffer: bufferDays },
        { cap: Infinity, buffer: 0 },
      ]
    : [{ cap: 2, buffer: 0 }, { cap: Infinity, buffer: 0 }];
  for (const { cap, buffer } of passes) {
    for (const task of open) {
      const target = addDays(task.dueDate, -buffer);
      const last = target < ctx.now.date ? ctx.now.date : target;
      for (const date of datesBetween(ctx.now.date, last)) {
        const key = `${task.taskId}|${date}`;
        let placedToday = perDay.get(key) ?? 0;
        while (idx.remaining(task) > 0 && placedToday < cap) {
          const need = idx.remaining(task);
          const limitLeft = ctx.prefs.dailyLimitMinutes - idx.dayLoad(date);
          let placed = false;
          for (const [s, e] of idx.free(date)) {
            const start = Math.ceil(s / 5) * 5;
            const size = Math.min(ctx.prefs.sessionMinutes, need, e - start, limitLeft);
            if (size < Math.min(need, MIN_CHUNK) || size < 5) continue;
            const slot: Slot = { id: randomUUID(), taskId: task.taskId, date, startMinute: start, minutes: size, status: 'planned' };
            idx.add(slot);
            proposed.push(slot);
            placedToday++;
            placed = true;
            break;
          }
          if (!placed) break;
        }
        perDay.set(key, placedToday);
        if (idx.remaining(task) === 0) break;
      }
    }
  }
  const missing = open.reduce((n, t) => n + idx.remaining(t), 0);
  return { proposed, missing, remaining: idx.remaining };
}

/** Days kept free before each deadline when no task ends up with more unplaced work. */
export const BUFFER_DAYS = 1;

/**
 * Proposes new sessions for every open task. Missed sessions (planned, on a past
 * day) do not count as scheduled time. The plan first tries to finish one day
 * before each deadline; if that leaves any task with more work unplaced than
 * planning right up to the deadlines, the latter is used. Whatever cannot fit
 * before the deadline is reported as a shortfall, never squeezed in.
 */
export function generatePlan(ctx: PlanContext, tasks: TaskInfo[]) {
  ctx.sessions = ctx.sessions.filter((s) => !isMissed(s, ctx.now.date));
  const base = new PlanIndex({ ...ctx, sessions: [...ctx.sessions] });
  const open = tasks
    .filter((t) => !t.done && t.dueDate >= ctx.now.date && base.remaining(t) > 0)
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        Number(b.priority === 'high') - Number(a.priority === 'high') ||
        a.taskId.localeCompare(b.taskId),
    );
  const needed = new Map(open.map((t) => [t.taskId, base.remaining(t)]));
  const attempt = (bufferDays: number) => {
    const trial = { ...ctx, sessions: [...ctx.sessions] };
    return { trial, ...place(trial, open, bufferDays) };
  };
  // The buffer must cost nothing: compared task by task, not in total, so it never
  // moves a shortfall onto a task with an earlier deadline.
  const buffered = attempt(BUFFER_DAYS);
  let plan = buffered;
  if (buffered.missing > 0) {
    const tight = attempt(0);
    if (open.some((t) => buffered.remaining(t) > tight.remaining(t))) plan = tight;
  }
  ctx.sessions = plan.trial.sessions;
  const shortfalls = open
    .map((t) => ({
      taskId: t.taskId,
      dueDate: t.dueDate,
      neededMinutes: needed.get(t.taskId)!,
      missingMinutes: plan.remaining(t),
    }))
    .filter((s) => s.missingMinutes > 0);
  return {
    proposed: plan.proposed,
    shortfalls,
    neededMinutes: [...needed.values()].reduce((a, b) => a + b, 0),
    placedMinutes: plan.proposed.reduce((a, p) => a + p.minutes, 0),
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
