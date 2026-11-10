import type { AppState, Availability, Task } from "./state";
import { minutesOfDay, parseISODate, todayISO } from "./dates";

/**
 * Client-side precheck mirroring planning-service rules, so the dialog can
 * explain a problem before sending. The server remains the authority.
 */
type Range = [number, number];
const overlaps = (a: Range, b: Range) => a[0] < b[1] && b[0] < a[1];
/** 0 = Monday … 6 = Sunday */
export const weekdayOf = (date: string) => (parseISODate(date).getDay() + 6) % 7;
export const windowsOn = (availability: Availability, date: string): Range[] =>
  availability.windows
    .filter((w) => w.weekday === weekdayOf(date))
    .map((w) => [w.startMinute, w.endMinute] as Range)
    .sort((a, b) => a[0] - b[0]);
export const busyOn = (availability: Availability, date: string) =>
  availability.busy.filter((b) => b.date === date);

/** Hour range the calendars show: every study window and busy period fits, never smaller than 08:00–18:00. */
export function viewHours(availability: Availability) {
  const timedBusy = availability.busy.filter((b) => !(b.startMinute === 0 && b.endMinute >= 1440));
  const starts = [
    ...availability.windows.map((w) => w.startMinute),
    ...timedBusy.map((b) => b.startMinute),
  ];
  const ends = [
    ...availability.windows.map((w) => w.endMinute),
    ...timedBusy.map((b) => b.endMinute),
  ];
  const from = Math.floor(Math.min(480, ...starts) / 60);
  const to = Math.ceil(Math.max(1080, ...ends) / 60);
  return { from, to, hours: to - from };
}
/** Parts of the visible range that are outside the study windows of `date`. */
export function closedRanges(availability: Availability, date: string, from: number, to: number): Range[] {
  const out: Range[] = [];
  let cursor = from;
  for (const [s, e] of windowsOn(availability, date)) {
    if (s > cursor) out.push([cursor, Math.min(s, to)]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < to) out.push([cursor, to]);
  return out.filter(([s, e]) => e > s);
}

export function remainingToSchedule(state: AppState, task: Task) {
  const allocated = state.sessions
    .filter((s) => s.taskId === task.id && !s.done)
    .reduce((n, s) => n + s.minutes, 0);
  return Math.max(0, task.minutes - allocated);
}
export function validateTimebox(
  state: AppState,
  task: Task,
  date: string,
  start: number,
  minutes: number,
  now = new Date(),
): string | null {
  const today = todayISO(now);
  const box: Range = [start, start + minutes];
  if (task.done) return "Công việc này đã hoàn thành.";
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > remainingToSchedule(state, task))
    return "Thời lượng phải từ 5 phút và không vượt phần còn lại chưa xếp.";
  if (date < today) return "Không thể xếp phiên vào ngày đã qua.";
  if (date === today && start < minutesOfDay(now))
    return "Giờ bắt đầu đã qua. Hãy chọn một giờ muộn hơn.";
  if (date > task.due) return "Phiên này nằm sau deadline của công việc.";
  if (busyOn(state.availability, date).some((b) => overlaps([b.startMinute, b.endMinute], box)))
    return "Khoảng giờ này trùng lịch bận bạn đã khai báo.";
  if (!windowsOn(state.availability, date).some(([s, e]) => s <= box[0] && box[1] <= e))
    return "Ngoài khung giờ học của bạn. Xem lại Lịch rảnh trong Cài đặt.";
  const sessions = state.sessions.filter((s) => s.date === date);
  if (sessions.reduce((n, s) => n + s.minutes, 0) + minutes > state.preferences.limit)
    return "Phiên mới sẽ vượt giới hạn tự học trong ngày.";
  const rest = state.preferences.rest;
  if (sessions.some((s) => overlaps(box, [s.start - rest, s.start + s.minutes + rest])))
    return "Khoảng giờ này trùng phiên khác hoặc chưa đủ thời gian nghỉ.";
  return null;
}

/** Earliest free start for `minutes` on `date`, or undefined when the day has no room. */
export function firstFreeStart(state: AppState, date: string, minutes: number, now = new Date()) {
  const today = todayISO(now);
  if (date < today) return undefined;
  const rest = state.preferences.rest;
  let free = windowsOn(state.availability, date);
  const cut = (c: Range) => {
    free = free.flatMap(([s, e]): Range[] =>
      !overlaps([s, e], c) ? [[s, e]] : ([[s, c[0]], [c[1], e]] as Range[]).filter(([a, b]) => b > a),
    );
  };
  for (const b of busyOn(state.availability, date)) cut([b.startMinute, b.endMinute]);
  if (date === today) cut([0, minutesOfDay(now)]);
  for (const s of state.sessions.filter((x) => x.date === date)) cut([s.start - rest, s.start + s.minutes + rest]);
  for (const [s, e] of free) {
    const start = Math.ceil(s / 5) * 5;
    if (start + minutes <= e) return start;
  }
  return undefined;
}
