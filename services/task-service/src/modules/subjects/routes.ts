import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  conflict,
  exec,
  isDuplicateKey,
  notFound,
  parse,
  rows,
  userIdOf,
  withTransaction,
  z,
  type Db,
  type Pool,
} from '@studybalance/service-kit';
import { emitTask, findTask, snapshot } from '../tasks/repository.js';

interface SubjectRow {
  id: string;
  name: string;
  short_name: string;
  color: 'pink' | 'blue' | 'yellow' | 'green';
  teacher: string;
  credits: number;
}
const toSubject = (r: SubjectRow) => ({
  id: r.id,
  name: r.name,
  short: r.short_name,
  color: r.color,
  teacher: r.teacher,
  credits: r.credits,
});
const fields = {
  name: z.string().trim().min(1).max(80),
  short: z.string().trim().max(30),
  color: z.enum(['pink', 'blue', 'yellow', 'green']),
  teacher: z.string().trim().max(60),
  credits: z.number().int().min(0).max(20),
};
const createSchema = z.object({
  id: z.uuid().optional(),
  name: fields.name,
  short: fields.short.optional(),
  color: fields.color,
  teacher: fields.teacher.default(''),
  credits: fields.credits.default(0),
});
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.uuid() });

async function findSubject(db: Db, userId: string, id: string) {
  const [row] = await rows<SubjectRow>(
    db,
    'SELECT id, name, short_name, color, teacher, credits FROM subjects WHERE id = ? AND user_id = ?',
    [id, userId],
  );
  return row ? toSubject(row) : null;
}

export function subjectsRouter(pool: Pool) {
  const router = Router();

  router.get('/subjects', async (_req, res) => {
    const list = await rows<SubjectRow>(
      pool,
      'SELECT id, name, short_name, color, teacher, credits FROM subjects WHERE user_id = ? ORDER BY created_at, id',
      [userIdOf(res)],
    );
    res.json({ items: list.map(toSubject) });
  });

  router.post('/subjects', async (req, res) => {
    const input = parse(createSchema, req.body);
    const userId = userIdOf(res);
    const id = input.id ?? randomUUID();
    try {
      await exec(
        pool,
        'INSERT INTO subjects (id, user_id, name, short_name, color, teacher, credits) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, userId, input.name, input.short || input.name, input.color, input.teacher, input.credits],
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await findSubject(pool, userId, id);
      if (!existing) throw conflict('ID_TAKEN', 'Subject id is already in use');
      res.json(existing);
      return;
    }
    res.status(201).json(await findSubject(pool, userId, id));
  });

  router.patch('/subjects/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(patchSchema, req.body);
    const userId = userIdOf(res);
    const current = await findSubject(pool, userId, id);
    if (!current) throw notFound('Subject');
    const next = { ...current, ...input };
    await exec(pool, 'UPDATE subjects SET name = ?, short_name = ?, color = ?, teacher = ?, credits = ? WHERE id = ?', [
      next.name,
      next.short || next.name,
      next.color,
      next.teacher,
      next.credits,
      id,
    ]);
    res.json(await findSubject(pool, userId, id));
  });

  // Tasks of a deleted subject move to "no subject"; each change is published like any task update.
  router.delete('/subjects/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const userId = userIdOf(res);
    await withTransaction(pool, async (conn) => {
      const [found] = await rows(conn, 'SELECT id FROM subjects WHERE id = ? AND user_id = ? FOR UPDATE', [id, userId]);
      if (!found) throw notFound('Subject');
      const affected = await rows<{ id: string }>(conn, 'SELECT id FROM tasks WHERE subject_id = ? FOR UPDATE', [id]);
      await exec(conn, 'UPDATE tasks SET subject_id = NULL, version = version + 1 WHERE subject_id = ?', [id]);
      await exec(conn, 'DELETE FROM subjects WHERE id = ?', [id]);
      for (const { id: taskId } of affected) {
        const task = (await findTask(conn, userId, taskId))!;
        await emitTask(conn, 'TaskUpdated', userId, taskId, task.version, snapshot(task), res.locals.correlationId);
      }
    });
    res.status(204).end();
  });

  return router;
}
