import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { addDays, localNow } from '@studybalance/service-kit';

export const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
];
export const TIMEZONE = 'Asia/Ho_Chi_Minh';
export const SYNC_DAYS = 60;
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function encrypt(value: string, key: Buffer, owner: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(owner));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decrypt(value: string, key: Buffer, owner: string) {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}
export interface BusySlot { id: string; date: string; startMinute: number; endMinute: number; label: string }
export function normalizeBusy(userId: string, periods: { start: string; end: string }[], from: string, to: string): BusySlot[] {
  const days = new Map<string, [number, number][]>();
  const lower = Date.parse(`${from}T00:00:00+07:00`);
  const upper = Date.parse(`${addDays(to, 1)}T00:00:00+07:00`);
  for (const p of periods) {
    const a = Date.parse(p.start), b = Date.parse(p.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) throw new Error('Invalid Google busy interval');
    let cursor = Math.max(lower, Math.floor(a / 60000) * 60000);
    const end = Math.min(upper, Math.ceil(b / 60000) * 60000);
    while (cursor < end) {
      const { date, minute } = localNow(TIMEZONE, new Date(cursor));
      const midnight = Date.parse(`${addDays(date, 1)}T00:00:00+07:00`);
      const segmentEnd = Math.min(end, midnight);
      const list = days.get(date) ?? [];
      list.push([minute, minute + (segmentEnd - cursor) / 60000]);
      days.set(date, list);
      cursor = segmentEnd;
    }
  }
  const result: BusySlot[] = [];
  for (const [date, intervals] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const merged: [number, number][] = [];
    for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    for (const [startMinute, endMinute] of merged) {
      const digest = hash(`${userId}:${date}:${startMinute}:${endMinute}`);
      const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      result.push({ id, date, startMinute, endMinute, label: 'Bận · Google Calendar' });
    }
  }
  return result;
}
export interface RawGoogleEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  transparency?: string;
  extendedProperties?: { private?: Record<string, string> };
}
export function normalizeGoogleEvents(
  userId: string,
  events: RawGoogleEvent[],
  from: string,
  to: string,
): BusySlot[] {
  const lower = Date.parse(`${from}T00:00:00+07:00`);
  const upper = Date.parse(`${addDays(to, 1)}T00:00:00+07:00`);
  const result: BusySlot[] = [];

  for (const event of events) {
    if (event.status === 'cancelled') continue;
    if (event.extendedProperties?.private?.studybalanceUser) continue;

    const summary = event.summary?.trim() || 'Sự kiện Google';
    let startInstant: number;
    let endInstant: number;

    if (event.start?.dateTime && event.end?.dateTime) {
      startInstant = Date.parse(event.start.dateTime);
      endInstant = Date.parse(event.end.dateTime);
    } else if (event.start?.date && event.end?.date) {
      startInstant = Date.parse(`${event.start.date}T00:00:00+07:00`);
      endInstant = Date.parse(`${event.end.date}T00:00:00+07:00`);
    } else {
      continue;
    }

    if (!Number.isFinite(startInstant) || !Number.isFinite(endInstant) || endInstant <= startInstant) {
      continue;
    }

    let cursor = Math.max(lower, Math.floor(startInstant / 60000) * 60000);
    const end = Math.min(upper, Math.ceil(endInstant / 60000) * 60000);

    while (cursor < end) {
      const { date, minute } = localNow(TIMEZONE, new Date(cursor));
      const midnight = Date.parse(`${addDays(date, 1)}T00:00:00+07:00`);
      const segmentEnd = Math.min(end, midnight);
      const startMinute = minute;
      const endMinute = minute + Math.round((segmentEnd - cursor) / 60000);

      const digest = hash(`${userId}:${event.id ?? ''}:${date}:${startMinute}:${endMinute}:${summary}`);
      const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      result.push({ id, date, startMinute, endMinute, label: summary });

      cursor = segmentEnd;
    }
  }

  return result.sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute);
}
export interface StudySession { id: string; taskId: string; date: string; startMinute: number; minutes: number; status: 'planned' | 'done' }
export function eventBody(session: StudySession, title: string, userId: string) {
  const instant = Date.parse(`${session.date}T00:00:00+07:00`) + session.startMinute * 60000;
  return {
    summary: `${session.status === 'done' ? '✓ ' : ''}${title}`,
    description: 'Phiên học từ StudyBalance. Hãy chỉnh sửa phiên trong StudyBalance để đồng bộ lịch.',
    start: { dateTime: new Date(instant).toISOString(), timeZone: TIMEZONE },
    end: { dateTime: new Date(instant + session.minutes * 60000).toISOString(), timeZone: TIMEZONE },
    extendedProperties: { private: { studybalanceUser: userId, studybalanceSession: session.id } },
  };
}
export const overlapsBusy = (session: StudySession, busy: BusySlot[]) => busy.some((b) =>
  b.date === session.date && session.startMinute < b.endMinute && session.startMinute + session.minutes > b.startMinute,
);
