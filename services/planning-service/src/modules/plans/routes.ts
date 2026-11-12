import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  conflict,
  enqueueEvent,
  exec,
  makeEvent,
  notFound,
  parse,
  rows,
  userIdOf,
  withTransaction,
  z,
  type Db,
  type Pool,
} from '@studybalance/service-kit';
import type { Slot } from '../sessions/rules.js';
import { planner } from '../planner/index.js';
import { SERVICE, emitSession, findSession, loadContext, loadPrefs, lockUser, openTasks } from '../sessions/repository.js';
import { fingerprint, isExpired, sameBasis } from '../proposals.js';

const idParam = z.object({ id: z.uuid() });
const generateSchema = z.object({
  /** Tasks the client expects to be planned; any not yet received via events → TASK_NOT_SYNCED. */
  taskIds: z.array(z.uuid()).max(500).default([]),
});

interface Result {
  proposed: Slot[];
  shortfalls: { taskId: string; dueDate: string; neededMinutes: number; missingMinutes: number }[];
  neededMinutes: number;
  placedMinutes: number;
}
interface ProposalRow {
  id: string;
  date: string;
  result: Result;
  basis: string[];
  status: 'preview' | 'applied' | 'stale';
  created_at: string;
}
const present = (r: ProposalRow) => ({ id: r.id, status: r.status, today: r.date, ...r.result, createdAt: r.created_at });
async function findProposal(db: Db, userId: string, id: string, lock = false) {
  const [row] = await rows<ProposalRow>(
    db,
    `SELECT id, date, result, basis, status, created_at FROM plan_proposals WHERE id = ? AND user_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id, userId],
  );
  return row ?? null;
}

export function plansRouter(pool: Pool) {
  const router = Router();

  /** Proposes sessions for all unscheduled work; nothing is saved until /apply. */
  router.post('/plans/generate', async (req, res) => {
    const { taskIds } = parse(generateSchema, req.body ?? {});
    const userId = userIdOf(res);
    if (taskIds.length) {
      const known = await rows<{ task_id: string }>(
        pool,
        'SELECT task_id FROM task_projection WHERE user_id = ? AND task_id IN (?)',
        [userId, taskIds],
      );
      if (known.length < new Set(taskIds).size) {
        throw conflict('TASK_NOT_SYNCED', 'Some tasks are not available to planning yet, retry shortly');
      }
    }
    const prefs = await loadPrefs(pool, userId);
    const ctx = await loadContext(pool, userId, prefs);
    const tasks = await openTasks(pool, userId, prefs.now.date);
    const basis = await fingerprint(pool, userId, prefs.now.date, ctx.versions, true);
    // CPU-heavy for many tasks: runs in a worker thread, the event loop stays free.
    const result: Result = await planner.generate(ctx, tasks);
    const id = randomUUID();
    await exec(pool, 'INSERT INTO plan_proposals (id, user_id, date, result, basis) VALUES (?, ?, ?, ?, ?)', [
      id,
      userId,
      prefs.now.date,
      JSON.stringify(result),
      JSON.stringify(basis),
    ]);
    res.status(201).json(present((await findProposal(pool, userId, id))!));
  });

  router.post('/plans/:id/apply', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const userId = userIdOf(res);
    const outcome = await withTransaction(pool, async (conn) => {
      const prefs = await lockUser(conn, userId);
      const proposal = await findProposal(conn, userId, id, true);
      if (!proposal) throw notFound('Plan proposal');
      if (proposal.status === 'applied') return { proposal, error: null };
      const ctx = await loadContext(conn, userId, prefs);
      const basis = await fingerprint(conn, userId, proposal.date, ctx.versions, true);
      if (
        proposal.status === 'stale' ||
        prefs.now.date !== proposal.date ||
        isExpired(proposal.created_at) ||
        !sameBasis(basis, proposal.basis)
      ) {
        await exec(conn, "UPDATE plan_proposals SET status = 'stale' WHERE id = ?", [id]);
        return { proposal, error: conflict('PLAN_STALE', 'Tasks or the plan changed since this proposal; generate a new one') };
      }
      for (const s of proposal.result.proposed) {
        await exec(
          conn,
          'INSERT INTO study_sessions (id, user_id, task_id, date, start_minute, minutes) VALUES (?, ?, ?, ?, ?, ?)',
          [s.id, userId, s.taskId, s.date, s.startMinute, s.minutes],
        );
        await emitSession(conn, userId, (await findSession(conn, userId, s.id))!, res.locals.correlationId);
      }
      await enqueueEvent(
        conn,
        makeEvent(SERVICE, 'PlanUpdated', {
          aggregateId: id,
          aggregateVersion: 1,
          userId,
          correlationId: res.locals.correlationId,
          payload: { sessionIds: proposal.result.proposed.map((s) => s.id), reason: 'plan_generated' },
        }),
      );
      await exec(conn, "UPDATE plan_proposals SET status = 'applied', applied_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [id]);
      return { proposal: (await findProposal(conn, userId, id))!, error: null };
    });
    if (outcome.error) throw outcome.error;
    res.json(present(outcome.proposal));
  });

  return router;
}
