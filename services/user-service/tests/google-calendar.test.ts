import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { HttpError } from '@studybalance/service-kit';
import {
  encrypt, decrypt, normalizeBusy, normalizeGoogleEvents, eventBody, overlapsBusy, type StudySession,
} from '../src/modules/google-calendar/core.js';
import { calendarRequest, googleError, listCalendars } from '../src/modules/google-calendar/client.js';

const user = '00000000-0000-4000-a000-000000000001';
const session: StudySession = { id: user, taskId: user, date: '2026-10-26', startMinute: 23 * 60 + 30, minutes: 90, status: 'planned' };

test('refresh tokens are encrypted, bound to the user, and tamper-evident', () => {
  const key = randomBytes(32);
  const first = encrypt('refresh-secret', key, user);
  const second = encrypt('refresh-secret', key, user);
  assert.notEqual(first, second);
  assert.ok(!first.includes('refresh-secret'));
  assert.equal(decrypt(first, key, user), 'refresh-secret');
  assert.throws(() => decrypt(first, key, 'another-user'));
  assert.throws(() => decrypt(first, randomBytes(32), user));
  const bytes = Buffer.from(first, 'base64'); bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decrypt(bytes.toString('base64'), key, user));
});

test('all-day and overnight Google intervals are split at Vietnam midnight', () => {
  const actual = normalizeBusy(user, [{ start: '2026-10-25T17:00:00Z', end: '2026-10-27T17:00:00Z' }], '2026-10-26', '2026-10-27');
  assert.deepEqual(actual.map(({ date, startMinute, endMinute }) => ({ date, startMinute, endMinute })), [
    { date: '2026-10-26', startMinute: 0, endMinute: 1440 },
    { date: '2026-10-27', startMinute: 0, endMinute: 1440 },
  ]);
});

test('overlapping calendars are merged and retry IDs remain stable', () => {
  const periods = [
    { start: '2026-10-26T09:00:00+07:00', end: '2026-10-26T10:00:00+07:00' },
    { start: '2026-10-26T09:30:00+07:00', end: '2026-10-26T11:00:00+07:00' },
    { start: '2026-10-26T11:00:00+07:00', end: '2026-10-26T12:00:00+07:00' },
  ];
  const actual = normalizeBusy(user, periods, '2026-10-26', '2026-10-26');
  assert.equal(actual.length, 1);
  assert.equal(actual[0].startMinute, 540);
  assert.equal(actual[0].endMinute, 720);
  assert.deepEqual(normalizeBusy(user, [...periods].reverse(), '2026-10-26', '2026-10-26'), actual);
});

test('busy ranges are clipped to the sync horizon and round outwards', () => {
  const result = normalizeBusy(user, [
    { start: '2026-10-25T23:59:59+07:00', end: '2026-10-26T00:00:01+07:00' },
    { start: '2026-10-26T23:59:59+07:00', end: '2026-10-27T01:00:00+07:00' },
  ], '2026-10-26', '2026-10-26');
  assert.deepEqual(result.map((b) => [b.startMinute, b.endMinute]), [[0, 1], [1439, 1440]]);
  assert.deepEqual(normalizeBusy(user, [], '2026-10-26', '2026-10-26'), []);
  assert.throws(() => normalizeBusy(user, [{ start: 'invalid', end: 'invalid' }], '2026-10-26', '2026-10-26'));
});

test('exported session keeps exact instants across midnight and carries ownership markers', () => {
  const body = eventBody(session, 'Ôn thi', user);
  assert.equal(body.start.dateTime, '2026-10-26T16:30:00.000Z');
  assert.equal(body.end.dateTime, '2026-10-26T18:00:00.000Z');
  assert.equal(body.extendedProperties.private.studybalanceSession, session.id);
  assert.equal(body.extendedProperties.private.studybalanceUser, user);
  assert.equal(body.summary, 'Ôn thi');
  assert.equal(eventBody({ ...session, status: 'done' }, 'Ôn thi', user).summary, '✓ Ôn thi');
});

test('touching intervals are not conflicts, actual overlaps are', () => {
  const busy = normalizeBusy(user, [{ start: '2026-10-26T09:00:00+07:00', end: '2026-10-26T10:00:00+07:00' }], '2026-10-26', '2026-10-26');
  assert.equal(overlapsBusy({ ...session, startMinute: 480, minutes: 60 }, busy), false);
  assert.equal(overlapsBusy({ ...session, startMinute: 600, minutes: 60 }, busy), false);
  assert.equal(overlapsBusy({ ...session, startMinute: 599, minutes: 60 }, busy), true);
});

test('Google HTTP errors never expose tokens or upstream response text', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('sensitive-token', { status: 401 });
  try {
    await assert.rejects(calendarRequest('secret', '/freeBusy'), (error: unknown) => error instanceof HttpError && error.code === 'GOOGLE_RECONNECT' && !error.message.includes('sensitive'));
  } finally { globalThis.fetch = original; }
  assert.equal(googleError({ response: { data: { error: 'invalid_grant' } } }).code, 'GOOGLE_RECONNECT');
});

test('calendar picker follows every pagination token', async () => {
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); requested.push(url);
    return Response.json(url.includes('pageToken=next')
      ? { items: [{ id: 'second', summary: 'Second' }] }
      : { items: [{ id: 'first', summary: 'First' }], nextPageToken: 'next' });
  };
  try {
    assert.deepEqual((await listCalendars('token')).map((c) => c.id), ['first', 'second']);
    assert.equal(requested.length, 2);
  } finally { globalThis.fetch = original; }
});

// Exercise the sync orchestration with fake HTTP/DB boundaries: no Google account or test data needed.
import { OAuth2Client } from 'google-auth-library';
import { syncGoogle } from '../src/modules/google-calendar/service.js';
import type { Pool } from '@studybalance/service-kit';

test('sync preserves cached busy periods if even one selected Google calendar fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalAccess = OAuth2Client.prototype.getAccessToken;
  const envNames = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY', 'APP_PUBLIC_URL'];
  const envBefore = envNames.map((k) => process.env[k]);
  const key = randomBytes(32);
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = key.toString('base64');
  process.env.APP_PUBLIC_URL = 'http://localhost:8088';
  const queries: string[] = [];
  let released = false;
  const conn = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ ok: 1 }]];
      if (sql.includes('SELECT * FROM google_connections')) return [[{
        user_id: user, refresh_cipher: encrypt('refresh', key, user), selected_calendars: ['primary', 'shared'], calendar_id: 'studybalance',
      }]];
      return [{ affectedRows: 1 }];
    },
    release: () => { released = true; },
  };
  const pool = { getConnection: async () => conn } as unknown as Pool;
  OAuth2Client.prototype.getAccessToken = (async () => ({ token: 'mock-token' })) as typeof originalAccess;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/study-sessions')) return Response.json({ items: [] });
    if (url.includes('/tasks?')) return Response.json({ items: [], nextOffset: null });
    if (url.includes('/calendarList')) return Response.json({ items: [{ id: 'owner', primary: true }, { id: 'shared' }] });
    if (url.endsWith('/freeBusy')) return Response.json({ calendars: { owner: { busy: [] }, shared: { errors: [{ reason: 'notFound' }] } } });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await assert.rejects(syncGoogle(pool, user, new TextEncoder().encode('a'.repeat(32))), (e: unknown) => e instanceof HttpError && e.code === 'GOOGLE_BUSY_UNAVAILABLE');
    assert.ok(!queries.some((q) => q.startsWith('DELETE FROM google_busy')));
    assert.ok(queries.some((q) => q.includes('error_code = ?')));
    assert.equal(released, true);
  } finally {
    globalThis.fetch = originalFetch;
    OAuth2Client.prototype.getAccessToken = originalAccess;
    envNames.forEach((name, i) => { if (envBefore[i] === undefined) delete process.env[name]; else process.env[name] = envBefore[i]; });
  }
});

test('normalizeGoogleEvents parses titles, splits overnight intervals, and ignores cancelled/app events', () => {
  const events = [
    {
      id: 'event-1',
      summary: 'Học tiếng Anh',
      start: { dateTime: '2026-10-26T09:00:00+07:00' },
      end: { dateTime: '2026-10-26T10:30:00+07:00' },
      status: 'confirmed',
    },
    {
      id: 'event-2',
      summary: 'Họp nhóm qua đêm',
      start: { dateTime: '2026-10-26T23:30:00+07:00' },
      end: { dateTime: '2026-10-27T01:00:00+07:00' },
      status: 'confirmed',
    },
    {
      id: 'event-3',
      summary: 'Sự kiện bị hủy',
      start: { dateTime: '2026-10-26T14:00:00+07:00' },
      end: { dateTime: '2026-10-26T15:00:00+07:00' },
      status: 'cancelled',
    },
    {
      id: 'event-4',
      summary: 'Phiên học StudyBalance',
      start: { dateTime: '2026-10-26T16:00:00+07:00' },
      end: { dateTime: '2026-10-26T17:00:00+07:00' },
      extendedProperties: { private: { studybalanceUser: user } },
    },
    {
      id: 'event-5',
      summary: 'Nghỉ lễ cả ngày',
      start: { date: '2026-10-27' },
      end: { date: '2026-10-28' },
      status: 'confirmed',
    },
  ];

  const actual = normalizeGoogleEvents(user, events, '2026-10-26', '2026-10-27');
  assert.equal(actual.length, 4);

  // event-1: 9:00 (540) to 10:30 (630)
  assert.equal(actual[0].label, 'Học tiếng Anh');
  assert.equal(actual[0].date, '2026-10-26');
  assert.equal(actual[0].startMinute, 540);
  assert.equal(actual[0].endMinute, 630);

  // event-2 (part 1): 23:30 (1410) to 24:00 (1440)
  assert.equal(actual[1].label, 'Họp nhóm qua đêm');
  assert.equal(actual[1].date, '2026-10-26');
  assert.equal(actual[1].startMinute, 1410);
  assert.equal(actual[1].endMinute, 1440);

  // event-2 (part 2): 00:00 (0) to 01:00 (60)
  assert.equal(actual[2].label, 'Họp nhóm qua đêm');
  assert.equal(actual[2].date, '2026-10-27');
  assert.equal(actual[2].startMinute, 0);
  assert.equal(actual[2].endMinute, 60);

  // event-5: all day on 2026-10-27 (0 to 1440)
  assert.equal(actual[3].label, 'Nghỉ lễ cả ngày');
  assert.equal(actual[3].date, '2026-10-27');
  assert.equal(actual[3].startMinute, 0);
  assert.equal(actual[3].endMinute, 1440);
});
