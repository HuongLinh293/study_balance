import { OAuth2Client } from 'google-auth-library';
import { CircuitBreaker, CircuitOpenError, HttpError, createLogger } from '@studybalance/service-kit';

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const rawKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const appUrl = process.env.APP_PUBLIC_URL ?? 'http://localhost:8088';
  if (!clientId || !clientSecret || !rawKey) return null;
  const key = Buffer.from(rawKey, 'base64');
  const url = new URL(appUrl);
  if (key.length !== 32 || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))))
    throw new HttpError(503, 'GOOGLE_NOT_CONFIGURED', 'Invalid Calendar configuration');
  return { clientId, clientSecret, key, origin: url.origin, redirectUri: `${url.origin}/api/user/integrations/google/callback` };
}
export function requireGoogleConfig() {
  const config = googleConfig();
  if (!config) throw new HttpError(503, 'GOOGLE_NOT_CONFIGURED', 'Google Calendar is not configured');
  return config;
}
export function oauthClient() {
  const c = requireGoogleConfig();
  return new OAuth2Client({ clientId: c.clientId, clientSecret: c.clientSecret, redirectUri: c.redirectUri });
}
export function authOauthClient() {
  const c = requireGoogleConfig();
  return new OAuth2Client({ clientId: c.clientId, clientSecret: c.clientSecret, redirectUri: `${c.origin}/api/user/auth/google/callback` });
}
export function googleError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const err = error as { response?: { status?: number; data?: { error?: string | { status?: string } } } };
  const code = err.response?.data?.error;
  if (code === 'invalid_grant' || err.response?.status === 401)
    return new HttpError(409, 'GOOGLE_RECONNECT', 'Reconnect Google Calendar');
  return new HttpError(502, 'GOOGLE_SYNC_FAILED', 'Google Calendar request failed');
}
/** Network errors, 5xx and 429 mean Google itself is struggling; 401/403/404 concern one user. */
const googleBreaker = new CircuitBreaker('google-calendar', {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  isFailure: (e) => e instanceof HttpError && (e.code === 'GOOGLE_SYNC_FAILED' || /^GOOGLE_HTTP_(5\d\d|429)$/.test(e.code)),
  log: createLogger('user-service'),
});
export async function calendarRequest<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await googleBreaker.exec(() => calendarFetch<T>(token, path, method, body));
  } catch (error) {
    if (error instanceof CircuitOpenError) throw new HttpError(503, 'GOOGLE_UNAVAILABLE', 'Google Calendar is temporarily unavailable');
    throw error;
  }
}
async function calendarFetch<T>(token: string, path: string, method: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
  } catch { throw new HttpError(502, 'GOOGLE_SYNC_FAILED', 'Google Calendar request failed'); }
  if (!response.ok) {
    const code = response.status === 401 ? 'GOOGLE_RECONNECT' : `GOOGLE_HTTP_${response.status}`;
    throw new HttpError(response.status === 401 ? 409 : 502, code, 'Google Calendar request failed');
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}
export interface CalendarEntry { id: string; summary: string; primary?: boolean; accessRole: string; description?: string }
export async function listCalendars(token: string) {
  const items: CalendarEntry[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: '250', showHidden: 'true' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await calendarRequest<{ items?: CalendarEntry[]; nextPageToken?: string }>(token, `/users/me/calendarList?${params}`);
    items.push(...page.items ?? []);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}
