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
const toTask = (row: TaskRow, steps: string[]) => ({
  id: row.id,
  title: row.title,
  subjectId: row.subject_id,
  dueDate: row.due_date,
  remainingMinutes: row.remaining_minutes,
  priority: row.priority,
  done: Boolean(row.done),
  note: row.note,
  steps,
  version: row.version,
});

const SELECT = `SELECT id, user_id, subject_id, title, due_date, remaining_minutes, priority, done, note, version FROM tasks`;

async function withSteps(db: Db, list: TaskRow[]) {
  if (!list.length) return [];
  const steps = await rows<{ task_id: string; title: string }>(
    db,
    'SELECT task_id, title FROM subtasks WHERE task_id IN (?) ORDER BY position',
    [list.map((t) => t.id)],
  );
  return list.map((t) => toTask(t, steps.filter((s) => s.task_id === t.id).map((s) => s.title)));
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
export async function replaceSteps(conn: PoolConnection, taskId: string, steps: string[]) {
  await conn.query('DELETE FROM subtasks WHERE task_id = ?', [taskId]);
  if (steps.length) {
    await conn.query('INSERT INTO subtasks (id, task_id, title, position) VALUES ?', [
      steps.map((title, i) => [crypto.randomUUID(), taskId, title, i]),
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
