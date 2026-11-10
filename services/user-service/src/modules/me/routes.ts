import { Router } from 'express';
import {
  conflict,
  exec,
  isValidTimeZone,
  notFound,
  parse,
  requireAuth,
  userIdOf,
  withTransaction,
  z,
  type Pool,
} from '@studybalance/service-kit';
import { loadProfile, publishPreferences } from './profile.js';

const patchSchema = z.object({
  /** Optimistic concurrency: reject when the profile changed since the client read it. */
  version: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  note: z.string().max(500).optional(),
  preferences: z
    .object({
      sessionMinutes: z.number().int().min(5).max(180),
      restMinutes: z.number().int().min(0).max(60),
      dailyLimitMinutes: z.number().int().min(30).max(720),
      reminders: z.boolean(),
      timezone: z.string().refine(isValidTimeZone, 'Unknown timezone'),
    })
    .partial()
    .optional(),
});

export function meRouter(pool: Pool, secret: Uint8Array) {
  const router = Router();
  router.use('/me', requireAuth(secret));

  router.get('/me', async (_req, res) => {
    const profile = await loadProfile(pool, userIdOf(res));
    if (!profile) throw notFound('User');
    res.json(profile);
  });

  router.patch('/me', async (req, res) => {
    const input = parse(patchSchema, req.body);
    const userId = userIdOf(res);
    const profile = await withTransaction(pool, async (conn) => {
      const current = await loadProfile(conn, userId, true);
      if (!current) throw notFound('User');
      if (input.version !== undefined && input.version !== current.version) {
        throw conflict('VERSION_CONFLICT', 'Profile was changed elsewhere', { current });
      }
      const prefs = { ...current.preferences, ...input.preferences };
      if (input.name !== undefined) await exec(conn, 'UPDATE users SET name = ? WHERE id = ?', [input.name, userId]);
      await exec(
        conn,
        `UPDATE preferences SET session_minutes = ?, rest_minutes = ?, daily_limit_minutes = ?,
                reminders = ?, timezone = ?, note = ?, version = version + 1 WHERE user_id = ?`,
        [
          prefs.sessionMinutes,
          prefs.restMinutes,
          prefs.dailyLimitMinutes,
          prefs.reminders,
          prefs.timezone,
          input.note ?? current.note,
          userId,
        ],
      );
      const next = (await loadProfile(conn, userId))!;
      if (JSON.stringify(next.preferences) !== JSON.stringify(current.preferences)) {
        await publishPreferences(conn, next, res.locals.correlationId);
      }
      return next;
    });
    res.json(profile);
  });
  return router;
}
