import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  HttpError,
  conflict,
  exec,
  isDuplicateKey,
  parse,
  requireAuth,
  rows,
  signAccessToken,
  userIdOf,
  withTransaction,
  z,
  type Pool,
  type PoolConnection,
} from '@studybalance/service-kit';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import { createFailureLimiter } from './rateLimit.js';
import { loadProfile, publishPreferences } from '../me/profile.js';
import { createDefaultAvailability } from '../availability/routes.js';
import { authOauthClient, googleConfig, requireGoogleConfig } from '../google-calendar/client.js';

export const REFRESH_COOKIE = 'sb_refresh';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Clients must send this header on cookie-authenticated calls (CSRF guard: forces a CORS preflight cross-site). */
export const CLIENT_HEADER = 'x-studybalance-client';

export interface AuthOptions {
  secret: Uint8Array;
  cookiePath: string;
  cookieSecure: boolean;
}

const email = z.string().trim().toLowerCase().email().max(254);
const registerSchema = z.object({
  email,
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(60),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function authRouter(pool: Pool, options: AuthOptions) {
  const router = Router();
  const limiter = createFailureLimiter(10, 15 * 60 * 1000);

  const setRefreshCookie = (res: Response, token: string) =>
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: options.cookieSecure,
      sameSite: 'strict',
      path: options.cookiePath,
      maxAge: REFRESH_TTL_MS,
    });
  const clearRefreshCookie = (res: Response) =>
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: options.cookieSecure,
      sameSite: 'strict',
      path: options.cookiePath,
    });
  const requireClientHeader = (req: Request) => {
    if (req.header(CLIENT_HEADER) !== 'web') {
      throw new HttpError(403, 'CSRF_HEADER_REQUIRED', `Header ${CLIENT_HEADER}: web is required`);
    }
  };

  async function issueRefreshToken(conn: PoolConnection, userId: string, familyId: string = randomUUID()) {
    const token = randomBytes(32).toString('base64url');
    await exec(
      conn,
      'INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), userId, familyId, sha256(token), new Date(Date.now() + REFRESH_TTL_MS)],
    );
    return token;
  }
  async function session(res: Response, conn: PoolConnection, userId: string, refreshToken: string) {
    const profile = await loadProfile(conn, userId);
    setRefreshCookie(res, refreshToken);
    return {
      accessToken: await signAccessToken(options.secret, userId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: profile,
    };
  }

  router.post('/auth/register', async (req, res) => {
    const input = parse(registerSchema, req.body);
    const passwordHash = await hashPassword(input.password);
    const body = await withTransaction(pool, async (conn) => {
      const userId = randomUUID();
      try {
        await exec(conn, 'INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)', [
          userId,
          input.email,
          passwordHash,
          input.name,
        ]);
      } catch (error) {
        if (isDuplicateKey(error)) throw conflict('EMAIL_TAKEN', 'Email is already registered');
        throw error;
      }
      await exec(conn, 'INSERT INTO preferences (user_id) VALUES (?)', [userId]);
      const profile = (await loadProfile(conn, userId))!;
      await publishPreferences(conn, profile, res.locals.correlationId);
      await createDefaultAvailability(conn, userId, res.locals.correlationId);
      return session(res, conn, userId, await issueRefreshToken(conn, userId));
    });
    res.status(201).json(body);
  });

  router.post('/auth/login', async (req, res) => {
    const input = parse(loginSchema, req.body);
    const key = `${req.ip}|${input.email}`;
    const retryAfter = limiter.retryAfterSeconds(key);
    if (retryAfter) {
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed login attempts, try again later');
    }
    const [user] = await rows<{ id: string; password_hash: string }>(
      pool,
      'SELECT id, password_hash FROM users WHERE email = ?',
      [input.email],
    );
    const valid = await verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) {
      limiter.fail(key);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    limiter.reset(key);
    const body = await withTransaction(pool, async (conn) =>
      session(res, conn, user.id, await issueRefreshToken(conn, user.id)),
    );
    res.json(body);
  });

  // Rotation: each refresh token works once. Reusing a rotated token revokes the whole family.
  router.post('/auth/refresh', async (req, res) => {
    requireClientHeader(req);
    const token = readCookie(req, REFRESH_COOKIE);
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing refresh token');
    const result = await withTransaction(pool, async (conn) => {
      const [row] = await rows<{ id: string; user_id: string; family_id: string; expires_at: string; revoked_at: string | null }>(
        conn,
        'SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ? FOR UPDATE',
        [sha256(token)],
      );
      if (!row) return null;
      if (row.revoked_at) {
        await exec(conn, 'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(3) WHERE family_id = ? AND revoked_at IS NULL', [
          row.family_id,
        ]);
        return 'reused' as const;
      }
      if (new Date(`${row.expires_at.replace(' ', 'T')}Z`).getTime() <= Date.now()) return null;
      await exec(conn, 'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [row.id]);
      return session(res, conn, row.user_id, await issueRefreshToken(conn, row.user_id, row.family_id));
    });
    if (!result || result === 'reused') {
      clearRefreshCookie(res);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Refresh token is invalid or expired');
    }
    res.json(result);
  });

  router.post('/auth/logout', async (req, res) => {
    requireClientHeader(req);
    const token = readCookie(req, REFRESH_COOKIE);
    if (token) {
      await exec(
        pool,
        `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(3)
          WHERE revoked_at IS NULL AND family_id = (SELECT family_id FROM (
            SELECT family_id FROM refresh_tokens WHERE token_hash = ?) AS t)`,
        [sha256(token)],
      );
    }
    clearRefreshCookie(res);
    res.status(204).end();
  });

  // Signs out every other device: all refresh tokens are revoked, this browser gets a new one.
  router.post('/auth/change-password', requireAuth(options.secret), async (req, res) => {
    const input = parse(changePasswordSchema, req.body);
    const userId = userIdOf(res);
    const [user] = await rows<{ password_hash: string }>(pool, 'SELECT password_hash FROM users WHERE id = ?', [userId]);
    const key = `${req.ip}|change:${userId}`;
    if (limiter.retryAfterSeconds(key)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts, try again later');
    if (!user || !(await verifyPassword(input.currentPassword, user.password_hash))) {
      limiter.fail(key);
      throw new HttpError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
    }
    limiter.reset(key);
    const passwordHash = await hashPassword(input.newPassword);
    const body = await withTransaction(pool, async (conn) => {
      await exec(conn, 'UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
      await exec(conn, 'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL', [userId]);
      return session(res, conn, userId, await issueRefreshToken(conn, userId));
    });
    res.json(body);
  });

  async function findOrCreateGoogleUser(
    conn: PoolConnection,
    identity: { sub: string; email: string; name?: string },
    correlationId?: string,
  ) {
    const normalizedEmail = identity.email.toLowerCase().trim();
    const [existing] = await rows<{ id: string; google_id: string | null }>(
      conn,
      'SELECT id, google_id FROM users WHERE google_id = ? OR email = ? LIMIT 1',
      [identity.sub, normalizedEmail],
    );

    if (existing) {
      if (!existing.google_id) {
        await exec(conn, 'UPDATE users SET google_id = ?, auth_provider = "google" WHERE id = ?', [
          identity.sub,
          existing.id,
        ]);
      }
      return existing.id;
    }

    const userId = randomUUID();
    const lockedPasswordHash = await hashPassword(randomBytes(32).toString('hex'));
    const userName = (identity.name?.trim() || normalizedEmail.split('@')[0]).slice(0, 60);

    await exec(
      conn,
      'INSERT INTO users (id, email, password_hash, name, google_id, auth_provider) VALUES (?, ?, ?, ?, ?, "google")',
      [userId, normalizedEmail, lockedPasswordHash, userName, identity.sub],
    );
    await exec(conn, 'INSERT INTO preferences (user_id) VALUES (?)', [userId]);
    const profile = (await loadProfile(conn, userId))!;
    await publishPreferences(conn, profile, correlationId);
    await createDefaultAvailability(conn, userId, correlationId);
    return userId;
  }

  router.get('/auth/google/config', (_req, res) => {
    let configured = false;
    let clientId: string | null = null;
    try {
      const cfg = googleConfig();
      if (cfg) {
        configured = true;
        clientId = cfg.clientId;
      }
    } catch { /* ignored */ }
    res.json({ configured, clientId });
  });

  const googleAuthSchema = z.object({ idToken: z.string().min(10) });

  router.post('/auth/google', async (req, res) => {
    const input = parse(googleAuthSchema, req.body);
    const config = requireGoogleConfig();
    const client = authOauthClient();
    let identity;
    try {
      const ticket = await client.verifyIdToken({
        idToken: input.idToken,
        audience: config.clientId,
      });
      identity = ticket.getPayload();
    } catch {
      throw new HttpError(401, 'INVALID_GOOGLE_TOKEN', 'Google authentication failed');
    }

    if (!identity?.sub || !identity.email || !identity.email_verified) {
      throw new HttpError(401, 'INVALID_GOOGLE_TOKEN', 'Google account is not verified');
    }
    const googleSub = identity.sub;
    const googleEmail = identity.email;
    const googleName = identity.name;

    const body = await withTransaction(pool, async (conn) => {
      const userId = await findOrCreateGoogleUser(conn, {
        sub: googleSub,
        email: googleEmail,
        name: googleName,
      }, res.locals.correlationId);
      return session(res, conn, userId, await issueRefreshToken(conn, userId));
    });

    res.json(body);
  });

  router.get('/auth/google/start', async (_req, res) => {
    const config = requireGoogleConfig();
    const client = authOauthClient();
    const state = randomBytes(32).toString('base64url');
    res.cookie('sb_gauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.origin.startsWith('https:'),
      path: '/api/user/auth',
      maxAge: 600_000,
    });
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account',
      scope: ['openid', 'email', 'profile'],
      state,
    });
    res.redirect(url);
  });

  router.get('/auth/google/callback', async (req, res) => {
    const config = requireGoogleConfig();
    const finish = (result: string) => res.redirect(`${config.origin}/?google_auth=${result}`);
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const storedState = readCookie(req, 'sb_gauth_state');
    res.clearCookie('sb_gauth_state', { path: '/api/user/auth' });
    if (!state || state !== storedState) return finish('invalid_state');
    if (req.query.error) return finish('denied');
    if (typeof req.query.code !== 'string') return finish('failed');

    try {
      const client = authOauthClient();
      const { tokens } = await client.getToken(req.query.code);
      if (!tokens.id_token) return finish('failed');
      const identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId })).getPayload();
      if (!identity?.sub || !identity.email || !identity.email_verified) return finish('failed');
      const googleSub = identity.sub;
      const googleEmail = identity.email;
      const googleName = identity.name;

      await withTransaction(pool, async (conn) => {
        const userId = await findOrCreateGoogleUser(conn, {
          sub: googleSub,
          email: googleEmail,
          name: googleName,
        });
        const refreshToken = await issueRefreshToken(conn, userId);
        setRefreshCookie(res, refreshToken);
      });

      return finish('success');
    } catch {
      return finish('failed');
    }
  });

  return router;
}
