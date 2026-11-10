import { randomBytes } from 'node:crypto';
import {
  CircuitBreaker, HttpError, addDays, createLogger, exec, localNow, rows, signAccessToken,
  type Pool, type PoolConnection,
} from '@studybalance/service-kit';
import { loadAvailability, publish } from '../availability/routes.js';
import { calendarRequest, googleError, listCalendars, oauthClient, requireGoogleConfig } from './client.js';
import {
  decrypt, eventBody, hash, normalizeBusy, normalizeGoogleEvents, overlapsBusy,
  SYNC_DAYS, TIMEZONE, type BusySlot, type RawGoogleEvent, type StudySession,
} from './core.js';

export interface Connection {
  user_id: string; google_subject: string; email: string; refresh_cipher: string | null;
  calendar_id: string | null; selected_calendars: string[] | string;
  last_sync_at: string | null; last_attempt_at: string | null; error_code: string | null; conflict_count: number;
}
export const selectedIds = (c: Connection): string[] => typeof c.selected_calendars === 'string' ? JSON.parse(c.selected_calendars) : c.selected_calendars;
export async function connection(pool: Pool | PoolConnection, userId: string) {
  return (await rows<Connection>(pool, 'SELECT * FROM google_connections WHERE user_id = ?', [userId]))[0];
}
/** A DB lock serialises callbacks, sync, selection changes and disconnect across replicas. */
export async function withGoogleLock<T>(pool: Pool, userId: string, work: (conn: PoolConnection) => Promise<T>) {
  const conn = await pool.getConnection();
  const name = `gcal:${userId}`;
  let acquired = false;
  try {
    acquired = (await rows<{ ok: number }>(conn, 'SELECT GET_LOCK(?, 0) AS ok', [name]))[0].ok === 1;
    if (!acquired) throw new HttpError(409, 'GOOGLE_SYNC_BUSY', 'Calendar synchronization is already running');
    return await work(conn);
  } finally {
    try { if (acquired) await conn.query('SELECT RELEASE_LOCK(?)', [name]); }
    finally { conn.release(); }
  }
}
export async function accessToken(c: Connection) {
  if (!c.refresh_cipher) throw new HttpError(409, 'GOOGLE_RECONNECT', 'Google Calendar is disconnected');
  const config = requireGoogleConfig();
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(c.refresh_cipher, config.key, c.user_id) });
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new HttpError(409, 'GOOGLE_RECONNECT', 'Reconnect Google Calendar');
    return token;
  } catch (error) { throw googleError(error); }
}
/** The service answered with 4xx: a problem with this request, not with the service. */
class RequestRejected extends Error {}
const breakerLog = createLogger('user-service');
const breakerOptions = { failureThreshold: 5, resetTimeoutMs: 30_000, isFailure: (e: unknown) => !(e instanceof RequestRejected), log: breakerLog };
// Once a service keeps failing, sync fails fast instead of waiting for timeouts on every user.
const breakers = {
  planning: new CircuitBreaker('planning-service', breakerOptions),
  task: new CircuitBreaker('task-service', breakerOptions),
};
async function internalGet<T>(breaker: CircuitBreaker, base: string, path: string, token: string): Promise<T> {
  try {
    return await breaker.exec(async () => {
      const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new RequestRejected(`HTTP ${res.status}`);
      return await res.json() as T;
    });
  } catch { throw new HttpError(503, 'GOOGLE_SOURCE_UNAVAILABLE', 'Cannot read the current StudyBalance schedule'); }
}
async function getStudyData(userId: string, secret: Uint8Array, from: string, to: string) {
  const jwt = await signAccessToken(secret, userId);
  const planning = process.env.PLANNING_SERVICE_URL ?? 'http://localhost:3003';
  const tasksUrl = process.env.TASK_SERVICE_URL ?? 'http://localhost:3002';
  const sessions = await internalGet<{ items: StudySession[] }>(breakers.planning, planning, `/study-sessions?from=${from}&to=${to}`, jwt);
  const titles = new Map<string, string>();
  for (let offset: number | null = 0; offset !== null;) {
    const page: { items: { id: string; title: string }[]; nextOffset: number | null } = await internalGet(breakers.task, tasksUrl, `/tasks?status=all&limit=500&offset=${offset}`, jwt);
    for (const t of page.items) titles.set(t.id, t.title);
    offset = page.nextOffset;
  }
  return { sessions: sessions.items, titles };
}
async function ensureCalendar(conn: PoolConnection, c: Connection, token: string) {
  if (c.calendar_id) {
    try {
      await calendarRequest(token, `/calendars/${encodeURIComponent(c.calendar_id)}`);
      return c.calendar_id;
    } catch (error) {
      if (!absent(error)) throw error;
      // The user removed the app's calendar on Google. A fresh calendar needs fresh mappings.
      await exec(conn, 'UPDATE google_connections SET calendar_id = NULL WHERE user_id = ?', [c.user_id]);
      await exec(conn, 'DELETE FROM google_exports WHERE user_id = ?', [c.user_id]);
      c.calendar_id = null;
    }
  }
  const marker = `StudyBalance integration ${c.user_id}`;
  // Also recover a calendar if Google created it but the previous DB write failed.
  const existing = (await listCalendars(token)).find((item) => item.description === marker && item.accessRole === 'owner');
  const created = existing ?? await calendarRequest<{ id: string }>(token, '/calendars', 'POST', {
    summary: 'StudyBalance', description: marker, timeZone: TIMEZONE,
  });
  await exec(conn, 'UPDATE google_connections SET calendar_id = ? WHERE user_id = ?', [created.id, c.user_id]);
  c.calendar_id = created.id;
  return created.id;
}
interface ExportRow { session_id: string; event_id: string; fingerprint: string | null; date: string }
const newEventId = () => `sb${randomBytes(20).toString('hex')}`;
const absent = (e: unknown) => e instanceof HttpError && ['GOOGLE_HTTP_404', 'GOOGLE_HTTP_410'].includes(e.code);

async function exportSessions(conn: PoolConnection, c: Connection, token: string, sessions: StudySession[], titles: Map<string, string>, from: string, to: string) {
  const calendarId = await ensureCalendar(conn, c, token);
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
  const mapped = new Map((await rows<ExportRow>(conn, 'SELECT * FROM google_exports WHERE user_id = ?', [c.user_id])).map((e) => [e.session_id, e]));
  for (const s of sessions) {
    const body = eventBody(s, titles.get(s.taskId) ?? 'Phiên học', c.user_id);
    const fingerprint = hash(JSON.stringify(body));
    let entry = mapped.get(s.id);
    if (entry?.fingerprint === fingerprint) continue;
    if (!entry) {
      entry = { session_id: s.id, event_id: newEventId(), fingerprint: null, date: s.date };
      await exec(conn, 'INSERT INTO google_exports (user_id, session_id, event_id, date) VALUES (?, ?, ?, ?)', [c.user_id, s.id, entry.event_id, s.date]);
    }
    let create = !entry.fingerprint;
    if (!create) {
      try { await calendarRequest(token, `${base}/${entry.event_id}`, 'PATCH', body); }
      catch (error) {
        if (!absent(error)) throw error;
        entry.event_id = newEventId();
        await exec(conn, 'UPDATE google_exports SET event_id = ?, fingerprint = NULL WHERE user_id = ? AND session_id = ?', [entry.event_id, c.user_id, s.id]);
        create = true;
      }
    }
    if (create) {
      try { await calendarRequest(token, base, 'POST', { id: entry.event_id, ...body }); }
      catch (error) {
        if (!(error instanceof HttpError) || error.code !== 'GOOGLE_HTTP_409') throw error;
        // A retry after an ambiguous network response must update the same event, not duplicate it.
        await calendarRequest(token, `${base}/${entry.event_id}`, 'PATCH', body);
      }
    }
    await exec(conn, 'UPDATE google_exports SET fingerprint = ?, date = ? WHERE user_id = ? AND session_id = ?', [fingerprint, s.date, c.user_id, s.id]);
  }
  const active = new Set(sessions.map((s) => s.id));
  for (const entry of mapped.values()) {
    // Past entries remain as history. Only remove known exports missing from the authoritative range.
    if (entry.date < from || entry.date > to || active.has(entry.session_id)) continue;
    try { await calendarRequest(token, `${base}/${entry.event_id}`, 'DELETE'); }
    catch (error) { if (!absent(error)) throw error; }
    await exec(conn, 'DELETE FROM google_exports WHERE user_id = ? AND session_id = ?', [c.user_id, entry.session_id]);
  }
}
export async function syncGoogle(pool: Pool, userId: string, secret: Uint8Array) {
  return withGoogleLock(pool, userId, async (conn) => {
    const c = await connection(conn, userId);
    if (!c?.refresh_cipher) throw new HttpError(409, 'GOOGLE_RECONNECT', 'Connect Google Calendar first');
    await exec(conn, 'UPDATE google_connections SET last_attempt_at = UTC_TIMESTAMP(3) WHERE user_id = ?', [userId]);
    try {
      const token = await accessToken(c);
      const from = localNow(TIMEZONE).date, to = addDays(from, SYNC_DAYS - 1);
      const { sessions, titles } = await getStudyData(userId, secret, from, to);
      // Keep the app's own calendar out of FreeBusy, or exported sessions would block themselves.
      const calendars = await listCalendars(token);
      const primary = calendars.find((item) => item.primary)?.id;
      if (selectedIds(c).includes('primary') && !primary)
        throw new HttpError(502, 'GOOGLE_BUSY_UNAVAILABLE', 'Primary Google calendar could not be read');
      const ids = [...new Set(selectedIds(c).map((id) => id === 'primary' ? primary! : id))].filter((id) => id !== c.calendar_id);
      let busy: BusySlot[] = [];
      let fetchedEvents = false;
      if (ids.length) {
        try {
          const events: RawGoogleEvent[] = [];
          for (const id of ids) {
            let pageToken: string | undefined;
            do {
              const params = new URLSearchParams({
                timeMin: `${from}T00:00:00+07:00`,
                timeMax: `${addDays(to, 1)}T00:00:00+07:00`,
                singleEvents: 'true',
                orderBy: 'startTime',
                maxResults: '250',
              });
              if (pageToken) params.set('pageToken', pageToken);
              const page = await calendarRequest<{ items?: RawGoogleEvent[]; nextPageToken?: string }>(
                token,
                `/calendars/${encodeURIComponent(id)}/events?${params}`,
              );
              events.push(...(page.items ?? []));
              pageToken = page.nextPageToken;
            } while (pageToken);
          }
          busy = normalizeGoogleEvents(userId, events, from, to);
          fetchedEvents = true;
        } catch {
          fetchedEvents = false;
        }
      } else {
        busy = [];
        fetchedEvents = true;
      }

      if (!fetchedEvents) {
        const periods: { start: string; end: string }[] = [];
        if (ids.length) {
          const data = await calendarRequest<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(token, '/freeBusy', 'POST', {
            timeMin: `${from}T00:00:00+07:00`, timeMax: `${addDays(to, 1)}T00:00:00+07:00`,
            timeZone: TIMEZONE, calendarExpansionMax: 50, items: ids.map((id) => ({ id })),
          });
          for (const id of ids) {
            const calendar = data.calendars[id];
            if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy))
              throw new HttpError(502, 'GOOGLE_BUSY_UNAVAILABLE', 'A selected Google calendar could not be read');
            periods.push(...calendar.busy);
          }
        }
        busy = normalizeBusy(userId, periods, from, to);
      }
      if (busy.length > 5000) throw new HttpError(502, 'GOOGLE_SYNC_FAILED', 'Too many busy periods');
      // Do not clear the last known busy data on a Google failure. Replace only a complete snapshot.
      await conn.beginTransaction();
      try {
        const tx = conn;
        await loadAvailability(tx, userId, true);
        const before = await rows<{ id: string }>(tx, 'SELECT id FROM google_busy WHERE user_id = ? ORDER BY id', [userId]);
        if (before.map((b) => b.id).join() !== busy.map((b) => b.id).sort().join()) {
          await exec(tx, 'DELETE FROM google_busy WHERE user_id = ?', [userId]);
          for (const b of busy) {
            await exec(
              tx,
              'INSERT INTO google_busy (id, user_id, date, start_minute, end_minute, summary) VALUES (?, ?, ?, ?, ?, ?)',
              [b.id, userId, b.date, b.startMinute, b.endMinute, b.label.slice(0, 250)],
            );
          }
          await publish(tx, userId);
        }
        await conn.commit();
      } catch (error) { await conn.rollback(); throw error; }
      const conflicts = sessions.filter((s) => s.status !== 'done' && overlapsBusy(s, busy)).length;
      await exec(conn, 'UPDATE google_connections SET conflict_count = ? WHERE user_id = ?', [conflicts, userId]);
      await exportSessions(conn, c, token, sessions, titles, from, to);
      await exec(conn, 'UPDATE google_connections SET last_sync_at = UTC_TIMESTAMP(3), error_code = NULL WHERE user_id = ?', [userId]);
      return { conflicts, busyCount: busy.length, sessionCount: sessions.length };
    } catch (error) {
      const safe = googleError(error);
      await exec(conn, 'UPDATE google_connections SET error_code = ? WHERE user_id = ?', [safe.code, userId]);
      throw safe;
    }
  });
}
export function startGoogleSync(pool: Pool, secret: Uint8Array) {
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const users = await rows<{ user_id: string }>(pool, `SELECT user_id FROM google_connections
        WHERE refresh_cipher IS NOT NULL AND (error_code IS NULL OR error_code <> 'GOOGLE_RECONNECT')
        AND (last_attempt_at IS NULL OR last_attempt_at < UTC_TIMESTAMP() - INTERVAL 5 MINUTE)`);
      for (const { user_id } of users) {
        if (stopped) break;
        await syncGoogle(pool, user_id, secret).catch(() => undefined);
      }
    } catch { /* Database readiness/recovery is reported by /ready. Retry on the next tick. */ }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
