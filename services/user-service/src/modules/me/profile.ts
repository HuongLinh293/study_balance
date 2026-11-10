import type { PreferencesSnapshot } from '@studybalance/event-contracts';
import { enqueueEvent, makeEvent, rows, type Db, type PoolConnection } from '@studybalance/service-kit';

export const SERVICE = 'user-service';

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  role?: string;
  session_minutes: number;
  rest_minutes: number;
  daily_limit_minutes: number;
  reminders: number;
  timezone: string;
  note: string;
  version: number;
}
export async function loadProfile(db: Db, userId: string, lock = false) {
  const [row] = await rows<ProfileRow>(
    db,
    `SELECT u.id, u.email, u.name, u.role, p.session_minutes, p.rest_minutes, p.daily_limit_minutes,
            p.reminders, p.timezone, p.note, p.version
       FROM users u JOIN preferences p ON p.user_id = u.id
      WHERE u.id = ?${lock ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  return row ? toProfile(row) : null;
}
export type Profile = ReturnType<typeof toProfile>;
function toProfile(row: ProfileRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role ?? 'student',
    note: row.note,
    version: row.version,
    preferences: {
      sessionMinutes: row.session_minutes,
      restMinutes: row.rest_minutes,
      dailyLimitMinutes: row.daily_limit_minutes,
      reminders: Boolean(row.reminders),
      timezone: row.timezone,
    } satisfies PreferencesSnapshot,
  };
}
export async function publishPreferences(conn: PoolConnection, profile: Profile, correlationId?: string) {
  await enqueueEvent(
    conn,
    makeEvent(SERVICE, 'PreferencesUpdated', {
      aggregateId: profile.id,
      aggregateVersion: profile.version,
      userId: profile.id,
      correlationId,
      payload: profile.preferences,
    }),
  );
}
