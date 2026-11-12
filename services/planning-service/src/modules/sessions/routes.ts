import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  HttpError,
  addDays,
  conflict,
  enqueueEvent,
  exec,
  isDuplicateKey,
  makeEvent,
  notFound,
  parse,
  userIdOf,
  withTransaction,
  z,
  type Pool,
  type PoolConnection,
} from '@studybalance/service-kit';
import { validateTimebox } from './rules.js';
import {
  SERVICE,
  emitSession,
  findSession,
  listSessions,
  loadContext,
  loadTask,
  lockUser,
} from './repository.js';

const isoDate = z.iso.date();
const timebox = {
  date: isoDate,
  startMinute: z.number().int().min(0).max(1439),
  minutes: z.number().int().min(1).max(600),
};
const createSchema = z.object({ id: z.uuid().optional(), taskId: z.uuid(), ...timebox });
const patchSchema = z.object({ version: z.number().int().positive().optional() }).extend(z.object(timebox).partial().shape);
const finishSchema = z.object({ actualMinutes: z.number().int().min(1).max(600) });
const rangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to && r.to <= addDays(r.from, 92), 'Range must be ordered and at most 93 days');
const idParam = z.object({ id: z.uuid() });

async function requireTask(conn: PoolConnection, userId: string, taskId: string) {
  const task = await loadTask(conn, userId, taskId);
  // Task events are asynchronous: a just-created task may not have reached Planning yet.
  if (!task) throw conflict('TASK_NOT_SYNCED', 'Task is not available to planning yet, retry shortly');
  if (task.deleted) throw notFound('Task');
  return task.info;
}

export function sessionsRouter(pool: Pool) {
  const router = Router();

  router.get('/study-sessions', async (req, res) => {
    const { from, to } = parse(rangeSchema, req.query);
    res.json({ items: await listSessions(pool, userIdOf(res), from, to) });
  });

  router.post('/study-sessions', async (req, res) => {
    const input = parse(createSchema, req.body);
    const userId = userIdOf(res);
    const id = input.id ?? randomUUID();
    const result = await withTransaction(pool, async (conn) => {
      const prefs = await lockUser(conn, userId);
      const existing = await findSession(conn, userId, id);
      if (existing) return { session: existing, created: false };
      const task = await requireTask(conn, userId, input.taskId);
      const ctx = await loadContext(conn, userId, prefs);
      const problem = validateTimebox(ctx, task, input.date, input.startMinute, input.minutes);
      if (problem) throw new HttpError(422, problem.code, problem.message);
      try {
        await exec(
          conn,
          'INSERT INTO study_sessions (id, user_id, task_id, date, start_minute, minutes) VALUES (?, ?, ?, ?, ?, ?)',
          [id, userId, input.taskId, input.date, input.startMinute, input.minutes],
        );
      } catch (error) {
        if (isDuplicateKey(error)) throw conflict('ID_TAKEN', 'Session id is already in use');
        throw error;
      }
      const session = (await findSession(conn, userId, id))!;
      await emitSession(conn, userId, session, res.locals.correlationId);
      return { session, created: true };
    });
    res.status(result.created ? 201 : 200).json(result.session);
  });

  router.patch('/study-sessions/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(patchSchema, req.body);
    const userId = userIdOf(res);
    const session = await withTransaction(pool, async (conn) => {
      const prefs = await lockUser(conn, userId);
      const current = await findSession(conn, userId, id);
      if (!current) throw notFound('Study session');
      if (input.version !== undefined && input.version !== current.version) {
        throw conflict('VERSION_CONFLICT', 'Session was changed elsewhere', { current });
      }
      if (current.status === 'done') throw conflict('SESSION_DONE', 'A finished session cannot be rescheduled');
      const next = { ...current, ...input };
      const task = await requireTask(conn, userId, current.taskId);
      const ctx = await loadContext(conn, userId, prefs, id);
      const problem = validateTimebox(ctx, task, next.date, next.startMinute, next.minutes);
      if (problem) throw new HttpError(422, problem.code, problem.message);
      await exec(
        conn,
        'UPDATE study_sessions SET date = ?, start_minute = ?, minutes = ?, version = version + 1 WHERE id = ?',
        [next.date, next.startMinute, next.minutes, id],
      );
      const updated = (await findSession(conn, userId, id))!;
      await emitSession(conn, userId, updated, res.locals.correlationId);
      return updated;
    });
    res.json(session);
  });

  router.delete('/study-sessions/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const userId = userIdOf(res);
    await withTransaction(pool, async (conn) => {
      await lockUser(conn, userId);
      const current = await findSession(conn, userId, id);
      if (!current) throw notFound('Study session');
      if (current.status === 'done') throw conflict('SESSION_DONE', 'A finished session is kept as study history');
      await exec(conn, 'DELETE FROM study_sessions WHERE id = ?', [id]);
      await emitSession(conn, userId, { ...current, version: current.version + 1 }, res.locals.correlationId, true);
    });
    res.status(204).end();
  });

  /**
   * Records actual study time only. Reducing the task's remaining minutes is a
   * separate, explicit call to task-service (PATCH /tasks/:id/progress with this sessionId).
   */
  router.post('/study-sessions/:id/finish', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(finishSchema, req.body);
    const userId = userIdOf(res);
    const session = await withTransaction(pool, async (conn) => {
      await lockUser(conn, userId);
      const current = await findSession(conn, userId, id);
      if (!current) throw notFound('Study session');
      if (current.status === 'done') return current;
      await exec(
        conn,
        "UPDATE study_sessions SET status = 'done', actual_minutes = ?, version = version + 1 WHERE id = ?",
        [input.actualMinutes, id],
      );
      const done = (await findSession(conn, userId, id))!;
      await emitSession(conn, userId, done, res.locals.correlationId);
      await enqueueEvent(
        conn,
        makeEvent(SERVICE, 'StudySessionCompleted', {
          aggregateId: id,
          aggregateVersion: done.version,
          userId,
          correlationId: res.locals.correlationId,
          payload: { taskId: done.taskId, date: done.date, actualMinutes: input.actualMinutes, plannedMinutes: done.minutes },
        }),
      );
      return done;
    });
    res.json(session);
  });

  return router;
}
