import { Router } from 'express';
import { localNow, parse, rows, userIdOf, z, type Pool } from '@studybalance/service-kit';
import { chart, periodRange, streak } from './summary.js';

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
    const daily = await rows<{ date: string; minutes: number }>(
      pool,
      'SELECT date, CAST(SUM(actual_minutes) AS SIGNED) AS minutes FROM session_facts WHERE user_id = ? GROUP BY date',
      [userId],
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
    });
  });

  return router;
}
