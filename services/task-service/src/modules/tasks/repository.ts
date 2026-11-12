import type { EventPayloads, TaskSnapshot } from '@studybalance/event-contracts';
import { enqueueEvent, makeEvent, rows, type Db, type PoolConnection } from '@studybalance/service-kit';

export const SERVICE = 'task-service';

interface TaskRow {
  id: string;
  user_id: string;
  subject_id: string | null;
  title: string;
  due_date: string;
  remaining_minutes: number;
  priority: 'high' | 'normal';
  done: number;
  note: string;
  version: number;
}
export type Task = ReturnType<typeof toTask>;
const toTask = (row: TaskRow, steps: { title: string; done: boolean }[]) => ({
  id: row.id,
  title: row.title,
  subjectId: row.subject_id,
  dueDate: row.due_date,
  remainingMinutes: row.remaining_minutes,
  priority: row.priority,
  done: Boolean(row.done),
  note: row.note,
  steps: steps.map((s) => s.title),
  /** Same order as `steps`: whether each step is ticked off. */
  stepsDone: steps.map((s) => s.done),
  version: row.version,
});

const SELECT = `SELECT id, user_id, subject_id, title, due_date, remaining_minutes, priority, done, note, version FROM tasks`;

async function withSteps(db: Db, list: TaskRow[]) {
  if (!list.length) return [];
  const steps = await rows<{ task_id: string; title: string; done: number }>(
    db,
    'SELECT task_id, title, done FROM subtasks WHERE task_id IN (?) ORDER BY position',
    [list.map((t) => t.id)],
  );
  const byTask = new Map<string, { title: string; done: boolean }[]>();
  for (const s of steps) {
    const list = byTask.get(s.task_id) ?? [];
    list.push({ title: s.title, done: Boolean(s.done) });
    byTask.set(s.task_id, list);
  }
  return list.map((t) => toTask(t, byTask.get(t.id) ?? []));
}
export async function findTask(db: Db, userId: string, id: string, lock = false) {
  const [row] = await rows<TaskRow>(db, `${SELECT} WHERE id = ? AND user_id = ?${lock ? ' FOR UPDATE' : ''}`, [id, userId]);
  return row ? (await withSteps(db, [row]))[0] : null;
}
export async function listTasks(db: Db, userId: string, status: 'open' | 'done' | 'all', limit: number, offset: number) {
  const filter = status === 'all' ? '' : ` AND done = ${status === 'done' ? 1 : 0}`;
  const list = await rows<TaskRow>(
    db,
    `${SELECT} WHERE user_id = ?${filter} ORDER BY due_date, created_at, id LIMIT ? OFFSET ?`,
    [userId, limit + 1, offset],
  );
  return {
    items: await withSteps(db, list.slice(0, limit)),
    nextOffset: list.length > limit ? offset + limit : null,
  };
}
/** Replaces the step list; a step whose title is kept stays ticked off. */
export async function replaceSteps(conn: PoolConnection, taskId: string, steps: string[]) {
  const ticked = (await rows<{ title: string }>(conn, 'SELECT title FROM subtasks WHERE task_id = ? AND done = 1', [taskId])).map(
    (s) => s.title,
  );
  await conn.query('DELETE FROM subtasks WHERE task_id = ?', [taskId]);
  if (steps.length) {
    await conn.query('INSERT INTO subtasks (id, task_id, title, position, done) VALUES ?', [
      steps.map((title, i) => {
        const at = ticked.indexOf(title);
        if (at >= 0) ticked.splice(at, 1);
        return [crypto.randomUUID(), taskId, title, i, at >= 0];
      }),
    ]);
  }
}
export const snapshot = (task: Task): TaskSnapshot => ({
  subjectId: task.subjectId,
  title: task.title,
  dueDate: task.dueDate,
  remainingMinutes: task.remainingMinutes,
  priority: task.priority,
  done: task.done,
});
export async function emitTask<T extends 'TaskCreated' | 'TaskUpdated' | 'TaskProgressUpdated' | 'TaskDeleted'>(
  conn: PoolConnection,
  type: T,
  userId: string,
  taskId: string,
  version: number,
  payload: EventPayloads[T],
  correlationId?: string,
) {
  await enqueueEvent(
    conn,
    makeEvent(SERVICE, type, { aggregateId: taskId, aggregateVersion: version, userId, correlationId, payload }),
  );
}
