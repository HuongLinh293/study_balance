import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  badRequest,
  conflict,
  exec,
  isDuplicateKey,
  notFound,
  parse,
  rows,
  userIdOf,
  withTransaction,
  z,
  type Pool,
  type PoolConnection,
} from '@studybalance/service-kit';
import { emitTask, findTask, listTasks, replaceSteps, snapshot } from './repository.js';

const isoDate = z.iso.date();
const fields = {
  title: z.string().trim().min(1).max(120),
  subjectId: z.uuid().nullable(),
  dueDate: isoDate,
  remainingMinutes: z.number().int().min(0).max(100_000),
  priority: z.enum(['high', 'normal']),
  done: z.boolean(),
  note: z.string().max(2000),
  steps: z.array(z.string().trim().min(1).max(120)).max(50),
};
const createSchema = z.object({
  /** Client-generated id makes create idempotent: retrying the same POST returns the stored task. */
  id: z.uuid().optional(),
  title: fields.title,
  subjectId: fields.subjectId.default(null),
  dueDate: fields.dueDate,
  remainingMinutes: fields.remainingMinutes,
  priority: fields.priority.default('normal'),
  note: fields.note.default(''),
  steps: fields.steps.default([]),
});
const patchSchema = z.object({ version: z.number().int().positive().optional() }).extend(
  z.object(fields).partial().shape,
);
const progressSchema = z.object({
  minutes: z.number().int().min(1).max(1440),
  /** Study session that produced this progress; the same session is applied at most once. */
  sessionId: z.uuid().optional(),
});
const listSchema = z.object({
  status: z.enum(['open', 'done', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParam = z.object({ id: z.uuid() });

async function assertSubject(conn: PoolConnection, userId: string, subjectId: string | null | undefined) {
  if (!subjectId) return;
  const [found] = await rows(conn, 'SELECT id FROM subjects WHERE id = ? AND user_id = ?', [subjectId, userId]);
  if (!found) throw badRequest('Unknown subject', [{ path: 'subjectId', message: 'Subject not found' }]);
}

export function tasksRouter(pool: Pool) {
  const router = Router();

  router.get('/tasks', async (req, res) => {
    const q = parse(listSchema, req.query);
    res.json(await listTasks(pool, userIdOf(res), q.status, q.limit, q.offset));
  });

  router.get('/tasks/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const task = await findTask(pool, userIdOf(res), id);
    if (!task) throw notFound('Task');
    res.json(task);
  });

  router.post('/tasks', async (req, res) => {
    const input = parse(createSchema, req.body);
    const userId = userIdOf(res);
    const id = input.id ?? randomUUID();
    const result = await withTransaction(pool, async (conn) => {
      await assertSubject(conn, userId, input.subjectId);
      try {
        await exec(
          conn,
          `INSERT INTO tasks (id, user_id, subject_id, title, due_date, remaining_minutes, priority, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, userId, input.subjectId, input.title, input.dueDate, input.remainingMinutes, input.priority, input.note],
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const existing = await findTask(conn, userId, id);
        if (!existing) throw conflict('ID_TAKEN', 'Task id is already in use');
        return { task: existing, created: false };
      }
      await replaceSteps(conn, id, input.steps);
      const task = (await findTask(conn, userId, id))!;
      await emitTask(conn, 'TaskCreated', userId, id, task.version, snapshot(task), res.locals.correlationId);
      return { task, created: true };
    });
    res.status(result.created ? 201 : 200).json(result.task);
  });

  router.patch('/tasks/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(patchSchema, req.body);
    const userId = userIdOf(res);
    const task = await withTransaction(pool, async (conn) => {
      const current = await findTask(conn, userId, id, true);
      if (!current) throw notFound('Task');
      if (input.version !== undefined && input.version !== current.version) {
        throw conflict('VERSION_CONFLICT', 'Task was changed elsewhere', { current });
      }
      await assertSubject(conn, userId, input.subjectId);
      const next = { ...current, ...input };
      await exec(
        conn,
        `UPDATE tasks SET subject_id = ?, title = ?, due_date = ?, remaining_minutes = ?, priority = ?,
                done = ?, note = ?, version = version + 1 WHERE id = ?`,
        [next.subjectId, next.title, next.dueDate, next.remainingMinutes, next.priority, next.done, next.note, id],
      );
      if (input.steps) await replaceSteps(conn, id, input.steps);
      const updated = (await findTask(conn, userId, id))!;
      await emitTask(conn, 'TaskUpdated', userId, id, updated.version, snapshot(updated), res.locals.correlationId);
      return updated;
    });
    res.json(task);
  });

  /** Progress already applied, so the UI can offer to apply a session that was missed. */
  router.get('/tasks/:id/progress', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const userId = userIdOf(res);
    if (!(await findTask(pool, userId, id))) throw notFound('Task');
    const list = await rows<{ session_id: string | null; minutes: number; created_at: string }>(
      pool,
      'SELECT session_id, minutes, created_at FROM progress_updates WHERE task_id = ? AND user_id = ? ORDER BY created_at',
      [id, userId],
    );
    res.json({ items: list.map((p) => ({ sessionId: p.session_id, minutes: p.minutes, createdAt: p.created_at })) });
  });

  // Explicit progress call after a study session (see spec §9): Task owns remaining minutes.
  router.patch('/tasks/:id/progress', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(progressSchema, req.body);
    const userId = userIdOf(res);
    const result = await withTransaction(pool, async (conn) => {
      const current = await findTask(conn, userId, id, true);
      if (!current) throw notFound('Task');
      try {
        await exec(conn, 'INSERT INTO progress_updates (id, task_id, user_id, session_id, minutes) VALUES (?, ?, ?, ?, ?)', [
          randomUUID(),
          id,
          userId,
          input.sessionId ?? null,
          input.minutes,
        ]);
      } catch (error) {
        if (isDuplicateKey(error)) return { task: current, applied: false };
        throw error;
      }
      await exec(
        conn,
        'UPDATE tasks SET remaining_minutes = GREATEST(0, remaining_minutes - ?), version = version + 1 WHERE id = ?',
        [input.minutes, id],
      );
      const task = (await findTask(conn, userId, id))!;
      await emitTask(
        conn,
        'TaskProgressUpdated',
        userId,
        id,
        task.version,
        { ...snapshot(task), loggedMinutes: input.minutes, sessionId: input.sessionId ?? null },
        res.locals.correlationId,
      );
      return { task, applied: true };
    });
    res.json(result);
  });

  router.delete('/tasks/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const userId = userIdOf(res);
    await withTransaction(pool, async (conn) => {
      const current = await findTask(conn, userId, id, true);
      if (!current) throw notFound('Task');
      await exec(conn, 'DELETE FROM tasks WHERE id = ?', [id]);
      // Tombstone with a newer version so consumers drop late updates of this task.
      await emitTask(conn, 'TaskDeleted', userId, id, current.version + 1, { deleted: true }, res.locals.correlationId);
    });
    res.status(204).end();
  });

  return router;
}
