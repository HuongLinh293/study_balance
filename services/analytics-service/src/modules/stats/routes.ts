import { Router } from 'express';
import { addDays, localNow, parse, rows, userIdOf, z, type Pool } from '@studybalance/service-kit';
import { STREAK_LOOKBACK_DAYS, chart, estimateRatio, periodRange, streak } from './summary.js';

const querySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
  /** Defaults to the user's local today. */
  date: z.iso.date().optional(),
});

export function statsRouter(pool: Pool) {
  const router = Router();

  router.get('/analytics/summary', async (req, res) => {
    const q = parse(querySchema, req.query);
    const userId = userIdOf(res);
    const [prefs] = await rows<{ timezone: string }>(pool, 'SELECT timezone FROM preferences_projection WHERE user_id = ?', [userId]);
    const today = localNow(prefs?.timezone).date;
    const date = q.date ?? today;
    const { from, to } = periodRange(q.period, date);
    // Only the days the chart and the streak need, not the whole history.
    const lookback = addDays(today, -STREAK_LOOKBACK_DAYS);
    const daily = await rows<{ date: string; minutes: number }>(
      pool,
      `SELECT date, CAST(SUM(actual_minutes) AS SIGNED) AS minutes FROM session_facts
        WHERE user_id = ? AND date >= ? GROUP BY date`,
      [userId, from < lookback ? from : lookback],
    );
    const byDate = new Map(daily.map((d) => [d.date, Number(d.minutes)]));
    const bySubject = await rows<{ subject_id: string | null; minutes: number }>(
      pool,
      `SELECT t.subject_id, CAST(SUM(s.actual_minutes) AS SIGNED) AS minutes
         FROM session_facts s LEFT JOIN task_facts t ON t.task_id = s.task_id
        WHERE s.user_id = ? AND s.date BETWEEN ? AND ?
        GROUP BY t.subject_id ORDER BY minutes DESC`,
      [userId, from, to],
    );
    const [tasks] = await rows<{ total: number; completed: number }>(
      pool,
      'SELECT COUNT(*) AS total, CAST(COALESCE(SUM(done), 0) AS SIGNED) AS completed FROM task_facts WHERE user_id = ? AND deleted = 0',
      [userId],
    );
    const [estimate] = await rows<{ planned: number | null; actual: number | null; sessions: number }>(
      pool,
      `SELECT CAST(SUM(planned_minutes) AS SIGNED) AS planned, CAST(SUM(actual_minutes) AS SIGNED) AS actual, COUNT(*) AS sessions
         FROM session_facts WHERE user_id = ? AND date BETWEEN ? AND ? AND planned_minutes IS NOT NULL`,
      [userId, from, to],
    );
    const [onTime] = await rows<{ finished: number; on_time: number }>(
      pool,
      `SELECT COUNT(*) AS finished, CAST(COALESCE(SUM(completed_on <= due_date), 0) AS SIGNED) AS on_time
         FROM task_facts WHERE user_id = ? AND deleted = 0 AND done = 1 AND completed_on IS NOT NULL AND due_date IS NOT NULL`,
      [userId],
    );
    const [overdue] = await rows<{ n: number }>(
      pool,
      'SELECT COUNT(*) AS n FROM task_facts WHERE user_id = ? AND deleted = 0 AND done = 0 AND due_date < ?',
      [userId, today],
    );
    const c = chart(q.period, date, byDate);
    res.json({
      period: q.period,
      from,
      to,
      ...c,
      totalMinutes: c.values.reduce((a, b) => a + b, 0),
      streak: streak(today, new Set(byDate.keys())),
      completedTasks: Number(tasks.completed),
      totalTasks: Number(tasks.total),
      bySubject: bySubject.map((s) => ({ subjectId: s.subject_id, minutes: Number(s.minutes) })),
      /** Planned vs actual minutes of sessions finished in the period. */
      estimate: {
        sessions: Number(estimate.sessions),
        plannedMinutes: Number(estimate.planned ?? 0),
        actualMinutes: Number(estimate.actual ?? 0),
        ratio: estimateRatio(Number(estimate.planned ?? 0), Number(estimate.actual ?? 0)),
      },
      /** Finished tasks completed on or before their due date (all time), and open tasks past due. */
      deadlines: { finished: Number(onTime.finished), onTime: Number(onTime.on_time), overdue: Number(overdue.n) },
    });
  });

  return router;
}
