import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { AvailabilitySnapshot, AvailabilityWindow } from '@studybalance/event-contracts';
import {
  addDays,
  badRequest,
  conflict,
  enqueueEvent,
  exec,
  localNow,
  makeEvent,
  notFound,
  parse,
  requireAuth,
  rows,
  userIdOf,
  withTransaction,
  z,
  type Db,
  type Pool,
  type PoolConnection,
} from '@studybalance/service-kit';
import { SERVICE } from '../me/profile.js';
import { DEFAULT_WINDOWS } from './defaults.js';

const MAX_WINDOWS_PER_DAY = 6;
const MAX_UPCOMING_BUSY = 200;

const minute = z.number().int().min(0).max(1440);
const windowSchema = z
  .object({ weekday: z.number().int().min(0).max(6), startMinute: minute, endMinute: minute })
  .refine((w) => w.startMinute < w.endMinute, 'startMinute must be before endMinute');
const putSchema = z.object({
  version: z.number().int().positive().optional(),
  windows: z.array(windowSchema).max(7 * MAX_WINDOWS_PER_DAY),
});
const busySchema = z
  .object({
    id: z.uuid().optional(),
    date: z.iso.date(),
    startMinute: minute,
    endMinute: minute,
    label: z.string().trim().max(80).default(''),
  })
  .refine((b) => b.startMinute < b.endMinute, 'startMinute must be before endMinute');
const idParam = z.object({ id: z.uuid() });

/** Sorted, non-overlapping windows; touching windows are allowed. */
export function normalizeWindows(windows: AvailabilityWindow[]) {
  const sorted = [...windows].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let day = 0; day < 7; day++) {
    const list = sorted.filter((w) => w.weekday === day);
    if (list.length > MAX_WINDOWS_PER_DAY) throw badRequest(`At most ${MAX_WINDOWS_PER_DAY} windows per day`);
    for (let i = 1; i < list.length; i++)
      if (list[i].startMinute < list[i - 1].endMinute) throw badRequest('Windows of the same day must not overlap');
  }
  return sorted;
}

async function timezoneOf(db: Db, userId: string) {
  const [row] = await rows<{ timezone: string }>(db, 'SELECT timezone FROM preferences WHERE user_id = ?', [userId]);
  return row?.timezone;
}
export async function loadAvailability(db: Db, userId: string, lock = false) {
  const [row] = await rows<{ windows: AvailabilityWindow[] | string; version: number }>(
    db,
    `SELECT windows, version FROM availability WHERE user_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  const since = addDays(localNow(await timezoneOf(db, userId)).date, -1);
  const busy = await rows<{ id: string; date: string; start_minute: number; end_minute: number; label: string }>(
    db,
    'SELECT id, date, start_minute, end_minute, label FROM busy_periods WHERE user_id = ? AND date >= ? ORDER BY date, start_minute',
    [userId, since],
  );
  const googleBusy = await rows<{ id: string; date: string; start_minute: number; end_minute: number; summary?: string }>(
    db, 'SELECT id, date, start_minute, end_minute, summary FROM google_busy WHERE user_id = ? AND date >= ? ORDER BY date, start_minute', [userId, since],
  );
  const windows = row ? (typeof row.windows === 'string' ? JSON.parse(row.windows) : row.windows) : DEFAULT_WINDOWS;
  return {
    version: row?.version ?? 0,
    windows: windows as AvailabilityWindow[],
    busy: [
      ...busy.map((b) => ({ id: b.id, date: b.date, startMinute: b.start_minute, endMinute: b.end_minute, label: b.label })),
      ...googleBusy.map((b) => ({ id: b.id, date: b.date, startMinute: b.start_minute, endMinute: b.end_minute, label: b.summary || 'Bận · Google Calendar', source: 'google' as const })),
    ],
  };
}
/** Bumps the version and publishes the full snapshot in the same transaction. */
export async function publish(conn: PoolConnection, userId: string, correlationId?: string) {
  await exec(conn, 'UPDATE availability SET version = version + 1 WHERE user_id = ?', [userId]);
  const current = await loadAvailability(conn, userId);
  const payload: AvailabilitySnapshot = { windows: current.windows, busy: current.busy };
  await enqueueEvent(
    conn,
    makeEvent(SERVICE, 'AvailabilityUpdated', {
      aggregateId: userId,
      aggregateVersion: current.version,
      userId,
      correlationId,
      payload,
    }),
  );
  return current;
}
export async function createDefaultAvailability(conn: PoolConnection, userId: string, correlationId?: string) {
  await exec(conn, 'INSERT INTO availability (user_id, windows, version) VALUES (?, ?, 0)', [userId, JSON.stringify(DEFAULT_WINDOWS)]);
  await publish(conn, userId, correlationId);
}

export function availabilityRouter(pool: Pool, secret: Uint8Array) {
  const router = Router();
  router.use(['/me/availability', '/me/busy-periods'], requireAuth(secret));

  router.get('/me/availability', async (_req, res) => {
    res.json(await loadAvailability(pool, userIdOf(res)));
  });

  router.put('/me/availability', async (req, res) => {
    const input = parse(putSchema, req.body);
    const windows = normalizeWindows(input.windows);
    const userId = userIdOf(res);
    const result = await withTransaction(pool, async (conn) => {
      await exec(conn, 'INSERT IGNORE INTO availability (user_id, windows, version) VALUES (?, ?, 0)', [
        userId,
        JSON.stringify(DEFAULT_WINDOWS),
      ]);
      const current = await loadAvailability(conn, userId, true);
      if (input.version !== undefined && input.version !== current.version) {
        throw conflict('VERSION_CONFLICT', 'Availability was changed elsewhere', { current });
      }
      await exec(conn, 'UPDATE availability SET windows = ? WHERE user_id = ?', [JSON.stringify(windows), userId]);
      return publish(conn, userId, res.locals.correlationId);
    });
    res.json(result);
  });

  router.post('/me/busy-periods', async (req, res) => {
    const input = parse(busySchema, req.body);
    const userId = userIdOf(res);
    const today = localNow(await timezoneOf(pool, userId)).date;
    if (input.date < today || input.date > addDays(today, 366)) {
      throw badRequest('Busy periods must be between today and one year ahead');
    }
    const result = await withTransaction(pool, async (conn) => {
      await exec(conn, 'INSERT IGNORE INTO availability (user_id, windows, version) VALUES (?, ?, 0)', [
        userId,
        JSON.stringify(DEFAULT_WINDOWS),
      ]);
      await loadAvailability(conn, userId, true);
      const id = input.id ?? randomUUID();
      const [existing] = await rows<{ user_id: string }>(conn, 'SELECT user_id FROM busy_periods WHERE id = ?', [id]);
      if (existing) {
        if (existing.user_id !== userId) throw conflict('ID_TAKEN', 'Busy period id is already in use');
        return { availability: await loadAvailability(conn, userId), created: false };
      }
      const [{ n }] = await rows<{ n: number }>(conn, 'SELECT COUNT(*) AS n FROM busy_periods WHERE user_id = ? AND date >= ?', [
        userId,
        today,
      ]);
      if (n >= MAX_UPCOMING_BUSY) throw badRequest(`At most ${MAX_UPCOMING_BUSY} upcoming busy periods`);
      await exec(
        conn,
        'INSERT INTO busy_periods (id, user_id, date, start_minute, end_minute, label) VALUES (?, ?, ?, ?, ?, ?)',
        [id, userId, input.date, input.startMinute, input.endMinute, input.label],
      );
      return { availability: await publish(conn, userId, res.locals.correlationId), created: true };
    });
    res.status(result.created ? 201 : 200).json(result.availability);
  });

  router.delete('/me/busy-periods/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const userId = userIdOf(res);
    await withTransaction(pool, async (conn) => {
      await loadAvailability(conn, userId, true);
      const result = await exec(conn, 'DELETE FROM busy_periods WHERE id = ? AND user_id = ?', [id, userId]);
      if (!result.affectedRows) throw notFound('Busy period');
      await publish(conn, userId, res.locals.correlationId);
    });
    res.status(204).end();
  });

  return router;
}
