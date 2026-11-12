import type { AvailabilityWindow, StudySessionSnapshot } from '@studybalance/event-contracts';
import {
  DEFAULT_TIMEZONE,
  enqueueEvent,
  exec,
  localNow,
  makeEvent,
  rows,
  type Db,
  type PoolConnection,
} from '@studybalance/service-kit';
import type { Availability, PlanContext, Slot, TaskInfo } from './rules.js';

export const SERVICE = 'planning-service';

interface SessionRow {
  id: string;
  task_id: string;
  date: string;
  start_minute: number;
  minutes: number;
  status: 'planned' | 'done';
  actual_minutes: number | null;
  version: number;
}
export type Session = ReturnType<typeof toSession>;
const toSession = (r: SessionRow) => ({
  id: r.id,
  taskId: r.task_id,
  date: r.date,
  startMinute: r.start_minute,
  minutes: r.minutes,
  status: r.status,
  actualMinutes: r.actual_minutes,
  version: r.version,
});
const SELECT = 'SELECT id, task_id, date, start_minute, minutes, status, actual_minutes, version FROM study_sessions';

/**
 * Serialises planning writes per user: concurrent requests for the same user
 * wait here, so overlap and daily-limit checks see a consistent day.
 * Also returns the user's preferences (defaults until PreferencesUpdated arrives).
 */
export async function lockUser(conn: PoolConnection, userId: string) {
  await exec(conn, 'INSERT IGNORE INTO preferences_projection (user_id) VALUES (?)', [userId]);
  return (await loadPrefs(conn, userId, true))!;
}
export async function loadPrefs(db: Db, userId: string, lock = false) {
  const [row] = await rows<{
    rest_minutes: number;
    daily_limit_minutes: number;
    session_minutes: number;
    timezone: string;
    version: number;
  }>(
    db,
    `SELECT rest_minutes, daily_limit_minutes, session_minutes, timezone, version FROM preferences_projection WHERE user_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  const prefs = row
    ? {
        restMinutes: row.rest_minutes,
        dailyLimitMinutes: row.daily_limit_minutes,
        sessionMinutes: row.session_minutes,
        timezone: row.timezone,
        version: row.version,
      }
    : { restMinutes: 10, dailyLimitMinutes: 240, sessionMinutes: 50, timezone: DEFAULT_TIMEZONE, version: 0 };
  return { ...prefs, now: localNow(prefs.timezone) };
}
/** Same default as user-service: 08:00–12:00 and 13:10–18:00 every day, until AvailabilityUpdated arrives. */
const DEFAULT_WINDOWS: AvailabilityWindow[] = Array.from({ length: 7 }, (_, weekday) => [
  { weekday, startMinute: 480, endMinute: 720 },
  { weekday, startMinute: 790, endMinute: 1080 },
]).flat();
const json = <T>(value: T | string): T => (typeof value === 'string' ? JSON.parse(value) : value);
export async function loadAvailability(db: Db, userId: string) {
  const [row] = await rows<{ windows: AvailabilityWindow[] | string; busy: Availability['busy'] | string; version: number }>(
    db,
    'SELECT windows, busy, version FROM availability_projection WHERE user_id = ?',
    [userId],
  );
  return {
    version: row?.version ?? 0,
    availability: row
      ? { windows: json(row.windows), busy: json(row.busy) }
      : ({ windows: DEFAULT_WINDOWS, busy: [] } satisfies Availability),
  };
}
type LoadedPrefs = Awaited<ReturnType<typeof loadPrefs>>;
/**
 * Planning context for a user: preferences, availability, and every session
 * that can constrain placement: sessions from today on. Planned sessions on past
 * days were missed and no longer reserve time for their task.
 */
export async function loadContext(db: Db, userId: string, prefs: LoadedPrefs, excludeId?: string): Promise<PlanContext & { versions: { prefs: number; availability: number } }> {
  const { availability, version } = await loadAvailability(db, userId);
  const list = await rows<SessionRow>(
    db,
    `${SELECT} WHERE user_id = ? AND date >= ? AND id <> ?`,
    [userId, prefs.now.date, excludeId ?? ''],
  );
  return {
    availability,
    prefs: { restMinutes: prefs.restMinutes, dailyLimitMinutes: prefs.dailyLimitMinutes, sessionMinutes: prefs.sessionMinutes },
    now: prefs.now,
    sessions: list.map(toSession).map(toSlot),
    versions: { prefs: prefs.version, availability: version },
  };
}
export async function loadTask(db: Db, userId: string, taskId: string) {
  const [row] = await rows<{ task_id: string; due_date: string; remaining_minutes: number; done: number; deleted: number }>(
    db,
    'SELECT task_id, due_date, remaining_minutes, done, deleted FROM task_projection WHERE task_id = ? AND user_id = ?',
    [taskId, userId],
  );
  if (!row) return null;
  return {
    deleted: Boolean(row.deleted),
    info: {
      taskId: row.task_id,
      dueDate: row.due_date,
      remainingMinutes: row.remaining_minutes,
      done: Boolean(row.done),
    } satisfies TaskInfo,
  };
}
export async function loadTasks(db: Db, userId: string, taskIds: string[]) {
  const map = new Map<string, TaskInfo>();
  if (!taskIds.length) return map;
  for (const t of await taskRows(db, userId, 'AND task_id IN (?)', [taskIds])) map.set(t.taskId, t);
  return map;
}
/** Open tasks with a deadline from `from` on, plus their versions for staleness checks. */
export async function openTasks(db: Db, userId: string, from: string) {
  return taskRows(db, userId, 'AND done = 0 AND due_date >= ?', [from]);
}
async function taskRows(db: Db, userId: string, where: string, params: unknown[]) {
  const list = await rows<{
    task_id: string;
    due_date: string;
    remaining_minutes: number;
    done: number;
    priority: 'high' | 'normal';
    version: number;
  }>(
    db,
    `SELECT task_id, due_date, remaining_minutes, done, priority, version FROM task_projection
      WHERE user_id = ? AND deleted = 0 ${where} ORDER BY due_date, task_id`,
    [userId, ...params],
  );
  return list.map((r) => ({
    taskId: r.task_id,
    dueDate: r.due_date,
    remainingMinutes: r.remaining_minutes,
    done: Boolean(r.done),
    priority: r.priority,
    version: r.version,
  }));
}
export async function findSession(db: Db, userId: string, id: string) {
  const [row] = await rows<SessionRow>(db, `${SELECT} WHERE id = ? AND user_id = ?`, [id, userId]);
  return row ? toSession(row) : null;
}
export async function listSessions(db: Db, userId: string, from: string, to: string) {
  return (
    await rows<SessionRow>(db, `${SELECT} WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_minute`, [
      userId,
      from,
      to,
    ])
  ).map(toSession);
}
export const toSlot = (s: Session): Slot => ({
  id: s.id,
  taskId: s.taskId,
  date: s.date,
  startMinute: s.startMinute,
  minutes: s.minutes,
  status: s.status,
});
export async function emitSession(
  conn: PoolConnection,
  userId: string,
  session: Session,
  correlationId?: string,
  deleted = false,
) {
  const payload: StudySessionSnapshot = {
    taskId: session.taskId,
    date: session.date,
    startMinute: session.startMinute,
    minutes: session.minutes,
    status: session.status,
    actualMinutes: session.actualMinutes,
    deleted,
  };
  await enqueueEvent(
    conn,
    makeEvent(SERVICE, 'StudySessionUpdated', {
      aggregateId: session.id,
      aggregateVersion: session.version,
      userId,
      correlationId,
      payload,
    }),
  );
}
