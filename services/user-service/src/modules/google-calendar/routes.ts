import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { CodeChallengeMethod } from 'google-auth-library';
import {
  HttpError, exec, parse, requireAuth, rows, userIdOf, withTransaction, z, type Pool,
} from '@studybalance/service-kit';
import { loadAvailability, publish } from '../availability/routes.js';
import { googleConfig, googleError, listCalendars, oauthClient, requireGoogleConfig } from './client.js';
import { decrypt, encrypt, hash, SCOPES, SYNC_DAYS } from './core.js';
import { accessToken, connection, selectedIds, syncGoogle, withGoogleLock } from './service.js';

const BASE = '/integrations/google';
const COOKIE = 'sb_google_oauth';
const COOKIE_PATH = '/api/user/integrations/google/callback';
export function googleCalendarRouter(pool: Pool, secret: Uint8Array) {
  const router = Router();
  router.get(`${BASE}/callback`, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const config = requireGoogleConfig();
    const finish = (result: string) => res.redirect(`${config.origin}/?google_calendar=${result}#settings`);
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const browser = (req.headers.cookie ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
    res.clearCookie(COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: 'lax', secure: config.origin.startsWith('https:') });
    if (!state || !browser) return finish('invalid_state');
    const stored = await withTransaction(pool, async (conn) => {
      const [row] = await rows<{ user_id: string; verifier_cipher: string }>(conn,
        'SELECT user_id, verifier_cipher FROM google_oauth_states WHERE state_hash = ? AND browser_hash = ? AND expires_at > UTC_TIMESTAMP() FOR UPDATE', [hash(state), hash(browser)]);
      if (row) await exec(conn, 'DELETE FROM google_oauth_states WHERE state_hash = ?', [hash(state)]);
      return row;
    });
    if (!stored) return finish('invalid_state');
    if (req.query.error) return finish('denied');
    if (typeof req.query.code !== 'string') return finish('failed');
    try {
      const client = oauthClient();
      const { tokens } = await client.getToken({ code: req.query.code, codeVerifier: decrypt(stored.verifier_cipher, config.key, stored.user_id) });
      const granted = new Set(tokens.scope?.split(' ') ?? []);
      const required = [
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'https://www.googleapis.com/auth/calendar.app.created',
      ];
      const hasEvents =
        granted.has('https://www.googleapis.com/auth/calendar.events.readonly') ||
        granted.has('https://www.googleapis.com/auth/calendar.events.freebusy') ||
        granted.has('https://www.googleapis.com/auth/calendar.readonly') ||
        granted.has('https://www.googleapis.com/auth/calendar');
      if (!required.every((s) => granted.has(s)) || !hasEvents)
        return finish('missing_scope');
      if (!tokens.id_token) return finish('failed');
      const identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId })).getPayload();
      if (!identity?.sub || !identity.email || !identity.email_verified) return finish('failed');
      await withGoogleLock(pool, stored.user_id, async (conn) => {
        const previous = await connection(conn, stored.user_id);
        const sameAccount = previous?.google_subject === identity.sub;
        const refreshCipher = tokens.refresh_token
          ? encrypt(tokens.refresh_token, config.key, stored.user_id)
          : sameAccount ? previous.refresh_cipher : null;
        if (!refreshCipher) throw new HttpError(409, 'GOOGLE_RECONNECT', 'Offline consent required');
        // Switching accounts must not reuse event IDs or a calendar belonging to the old account.
        await conn.beginTransaction();
        try {
          if (!sameAccount) {
            await loadAvailability(conn, stored.user_id, true);
            await exec(conn, 'DELETE FROM google_exports WHERE user_id = ?', [stored.user_id]);
            await exec(conn, 'DELETE FROM google_busy WHERE user_id = ?', [stored.user_id]);
            await publish(conn, stored.user_id);
          }
          await exec(conn, `INSERT INTO google_connections
            (user_id, google_subject, email, refresh_cipher, calendar_id, selected_calendars)
            VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE google_subject = VALUES(google_subject), email = VALUES(email),
            refresh_cipher = VALUES(refresh_cipher), calendar_id = VALUES(calendar_id), selected_calendars = VALUES(selected_calendars),
            last_attempt_at = NULL, last_sync_at = NULL, error_code = NULL, conflict_count = 0`, [
              stored.user_id, identity.sub, identity.email, refreshCipher,
              sameAccount ? previous.calendar_id : null, JSON.stringify(sameAccount ? selectedIds(previous) : ['primary']),
            ]);
          await conn.commit();
        } catch (error) { await conn.rollback(); throw error; }
      });
      // Worker performs initial sync; the UI also offers an immediate sync.
      return finish('connected');
    } catch { return finish('failed'); }
  });

  router.use(BASE, requireAuth(secret), (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get(`${BASE}/status`, async (_req, res) => {
    const c = await connection(pool, userIdOf(res));
    let configured = false;
    try { configured = !!googleConfig(); } catch { /* Invalid/incomplete server config is displayed as unavailable. */ }
    res.json({ configured, connected: !!c?.refresh_cipher, email: c?.refresh_cipher ? c.email : null,
      calendarId: c?.refresh_cipher ? c.calendar_id : null, selectedCalendarIds: c ? selectedIds(c) : ['primary'],
      lastSyncAt: c?.last_sync_at ? `${c.last_sync_at.replace(' ', 'T')}Z` : null,
      errorCode: c?.error_code ?? null, conflicts: c?.conflict_count ?? 0, syncDays: SYNC_DAYS,
    });
  });
  router.post(`${BASE}/connect`, async (_req, res) => {
    const config = requireGoogleConfig();
    const userId = userIdOf(res);
    const state = randomBytes(32).toString('base64url');
    const browser = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await exec(pool, 'DELETE FROM google_oauth_states WHERE user_id = ? OR expires_at <= UTC_TIMESTAMP()', [userId]);
    await exec(pool, 'INSERT INTO google_oauth_states (state_hash, user_id, browser_hash, verifier_cipher, expires_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL 10 MINUTE)',
      [hash(state), userId, hash(browser), encrypt(verifier, config.key, userId)]);
    res.cookie(COOKIE, browser, { httpOnly: true, sameSite: 'lax', secure: config.origin.startsWith('https:'), path: COOKIE_PATH, maxAge: 600_000 });
    res.json({ url: oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state, code_challenge: challenge, code_challenge_method: CodeChallengeMethod.S256 }) });
  });
  router.get(`${BASE}/calendars`, async (_req, res) => {
    const c = await connection(pool, userIdOf(res));
    if (!c?.refresh_cipher) throw new HttpError(409, 'GOOGLE_RECONNECT', 'Connect Google Calendar first');
    try {
      const calendars = await listCalendars(await accessToken(c));
      res.json({ items: calendars.filter((item) => item.id !== c.calendar_id).map((item) => ({ id: item.id, name: item.summary, primary: !!item.primary })) });
    } catch (error) { throw googleError(error); }
  });
  router.put(`${BASE}/calendars`, async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string().min(1).max(1024)).max(20) }), req.body);
    const userId = userIdOf(res);
    await withGoogleLock(pool, userId, async (conn) => {
      const c = await connection(conn, userId);
      if (!c?.refresh_cipher) throw new HttpError(409, 'GOOGLE_RECONNECT', 'Connect Google Calendar first');
      const calendars = await listCalendars(await accessToken(c));
      const allowed = new Set(calendars.filter((i) => i.id !== c.calendar_id).map((i) => i.id));
      if (ids.some((id) => !allowed.has(id))) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown Google calendar');
      await exec(conn, 'UPDATE google_connections SET selected_calendars = ?, last_attempt_at = NULL WHERE user_id = ?', [JSON.stringify([...new Set(ids)]), userId]);
    });
    res.json(await syncGoogle(pool, userId, secret));
  });
  router.post(`${BASE}/sync`, async (_req, res) => res.json(await syncGoogle(pool, userIdOf(res), secret)));
  router.post(`${BASE}/disconnect`, async (_req, res) => {
    const userId = userIdOf(res);
    await withGoogleLock(pool, userId, async (conn) => {
      // Remove local credentials even if Google's revoke endpoint is temporarily unreachable.
      const c = await connection(conn, userId);
      let token: string | null = null;
      if (c?.refresh_cipher) {
        try { token = decrypt(c.refresh_cipher, requireGoogleConfig().key, userId); }
        catch { /* Local disconnect must work even if server credentials changed. */ }
      }
      await conn.beginTransaction();
      try {
        await loadAvailability(conn, userId, true);
        await exec(conn, 'UPDATE google_connections SET refresh_cipher = NULL, error_code = NULL, conflict_count = 0 WHERE user_id = ?', [userId]);
        await exec(conn, 'DELETE FROM google_oauth_states WHERE user_id = ?', [userId]);
        await exec(conn, 'DELETE FROM google_busy WHERE user_id = ?', [userId]);
        await publish(conn, userId);
        await conn.commit();
      } catch (error) { await conn.rollback(); throw error; }
      let revoked = !c?.refresh_cipher;
      if (token) {
        try {
          const response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10000) });
          revoked = response.ok;
        } catch { /* Report that manual revocation may still be necessary. */ }
      }
      res.json({ disconnected: true, revoked });
    });
  });
  return router;
}
