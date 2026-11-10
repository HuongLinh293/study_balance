import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  HttpError,
  addDays,
  badRequest,
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
import { simulateBusy, type Slot } from '../sessions/rules.js';
import { SERVICE, emitSession, findSession, loadContext, loadPrefs, loadTasks, lockUser } from '../sessions/repository.js';
import { fingerprint, isExpired, sameBasis } from '../proposals.js';

const minute = z.number().int().min(0).max(1440);
const createSchema = z.union([
  z.object({ scenario: z.enum(['afternoon', 'whole']) }),
  z
    .object({ date: z.iso.date(), startMinute: minute, endMinute: minute, label: z.string().trim().max(80).default('') })
    .refine((b) => b.startMinute < b.endMinute, 'startMinute must be before endMinute'),
]);
const applySchema = z.object({
  /** Return sessions that could not be placed to the backlog instead of refusing to apply. */
  dropUnscheduled: z.boolean().default(false),
});
const idParam = z.object({ id: z.uuid() });

interface Result {
  busy: { date: string; startMinute: number; endMinute: number; label: string };
  changed: Slot[];
  moved: Slot[];
  unscheduled: (Slot & { reason: 'deadline' | 'no_time' })[];
}
interface SimulationRow {
  id: string;
  scenario: string;
  date: string;
  result: Result;
  basis: string[];
  status: 'preview' | 'applied' | 'stale';
  created_at: string;
}
const present = (r: SimulationRow) => ({
  id: r.id,
  scenario: r.scenario,
  status: r.status,
  ...r.result,
  feasible: r.result.unscheduled.length === 0,
  createdAt: r.created_at,
});
async function findSimulation(db: Db, userId: string, id: string, lock = false) {
  const [row] = await rows<SimulationRow>(
    db,
    `SELECT id, scenario, date, result, basis, status, created_at FROM simulations WHERE id = ? AND user_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id, userId],
  );
  return row ?? null;
}

export function simulationsRouter(pool: Pool) {
  const router = Router();

  // Preview only: nothing in the current plan changes until /apply.
  router.post('/simulations', async (req, res) => {
    const input = parse(createSchema, req.body);
    const userId = userIdOf(res);
    const prefs = await loadPrefs(pool, userId);
    const today = prefs.now.date;
    const busy =
      'scenario' in input
        ? {
            date: today,
            startMinute: input.scenario === 'afternoon' ? 12 * 60 : 0,
            endMinute: 1440,
            label: input.scenario === 'afternoon' ? 'Bận chiều nay' : 'Nghỉ cả ngày',
          }
        : input;
    if (busy.date < today || busy.date > addDays(today, 30)) {
      throw badRequest('Busy date must be between today and 30 days ahead');
    }
    const ctx = await loadContext(pool, userId, prefs);
    const tasks = await loadTasks(pool, userId, [...new Set(ctx.sessions.map((s) => s.taskId))]);
    const basis = await fingerprint(pool, userId, today, ctx.versions, false);
    const result: Result = { busy, ...simulateBusy(ctx, busy, tasks) };
    const id = randomUUID();
    await exec(pool, 'INSERT INTO simulations (id, user_id, scenario, date, result, basis) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      userId,
      'scenario' in input ? input.scenario : 'custom',
      today,
      JSON.stringify(result),
      JSON.stringify(basis),
    ]);
    res.status(201).json(present((await findSimulation(pool, userId, id))!));
  });

  router.get('/simulations/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const simulation = await findSimulation(pool, userIdOf(res), id);
    if (!simulation) throw notFound('Simulation');
    res.json(present(simulation));
  });

  router.post('/simulations/:id/apply', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { dropUnscheduled } = parse(applySchema, req.body ?? {});
    const userId = userIdOf(res);
    const outcome = await withTransaction(pool, async (conn) => {
      const prefs = await lockUser(conn, userId);
      const simulation = await findSimulation(conn, userId, id, true);
      if (!simulation) throw notFound('Simulation');
      if (simulation.status === 'applied') return { simulation, error: null };
      const ctx = await loadContext(conn, userId, prefs);
      const basis = await fingerprint(conn, userId, simulation.date, ctx.versions, false);
      if (
        simulation.status === 'stale' ||
        prefs.now.date !== simulation.date ||
        isExpired(simulation.created_at) ||
        !sameBasis(basis, simulation.basis)
      ) {
        await exec(conn, "UPDATE simulations SET status = 'stale' WHERE id = ?", [id]);
        // Commit the stale mark, then report the conflict.
        return { simulation, error: conflict('SIMULATION_STALE', 'The plan changed since this preview; create a new one') };
      }
      const { moved, unscheduled } = simulation.result;
      if (unscheduled.length && !dropUnscheduled) {
        return { simulation, error: new HttpError(422, 'SIMULATION_INFEASIBLE', 'Some sessions could not be placed') };
      }
      for (const move of moved) {
        await exec(conn, 'UPDATE study_sessions SET date = ?, start_minute = ?, version = version + 1 WHERE id = ?', [
          move.date,
          move.startMinute,
          move.id,
        ]);
        await emitSession(conn, userId, (await findSession(conn, userId, move.id))!, res.locals.correlationId);
      }
      // Dropped sessions free their minutes: the task shows them again as unscheduled.
      for (const drop of unscheduled) {
        const session = (await findSession(conn, userId, drop.id))!;
        await exec(conn, 'DELETE FROM study_sessions WHERE id = ?', [drop.id]);
        await emitSession(conn, userId, { ...session, version: session.version + 1 }, res.locals.correlationId, true);
      }
      await enqueueEvent(
        conn,
        makeEvent(SERVICE, 'PlanUpdated', {
          aggregateId: id,
          aggregateVersion: 1,
          userId,
          correlationId: res.locals.correlationId,
          payload: { sessionIds: [...moved, ...unscheduled].map((m) => m.id), reason: 'simulation_applied' },
        }),
      );
      await exec(conn, "UPDATE simulations SET status = 'applied', applied_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [id]);
      return { simulation: (await findSimulation(conn, userId, id))!, error: null };
    });
    if (outcome.error) throw outcome.error;
    res.json(present(outcome.simulation));
  });

  return router;
}
