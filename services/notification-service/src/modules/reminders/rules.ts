import { addDays } from '@studybalance/service-kit';

export interface ReminderTask {
  taskId: string;
  title: string;
  dueDate: string;
  remainingMinutes: number;
}
/** A planned session today, for the "starting soon" reminder. */
export interface TodaySession {
  sessionId: string;
  title: string;
  startMinute: number;
  minutes: number;
}
/** How long before a session its reminder appears. */
export const SESSION_LEAD_MINUTES = 15;
export interface Reminder {
  kind: 'deadline' | 'plan' | 'session';
  /** Unique per user: the same reminder is never stored twice, even with several schedulers. */
  dedupeKey: string;
  taskId: string | null;
  title: string;
  body: string;
}
const shortDate = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const duration = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}p` : ''}` : `${minutes} phút`;

/**
 * Reminders due for one user on `today` (their local date). A session's reminder
 * shows from SESSION_LEAD_MINUTES before it starts until it ends.
 */
export function remindersFor(
  today: string,
  tasks: ReminderTask[],
  pendingSessionsToday: number,
  sessionsToday: TodaySession[] = [],
  nowMinute = 0,
): Reminder[] {
  const tomorrow = addDays(today, 1);
  const list: Reminder[] = tasks
    .filter((t) => t.dueDate <= tomorrow)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title))
    .map((t) => ({
      kind: 'deadline',
      dedupeKey: `due:${t.taskId}:${t.dueDate}:${today}`,
      taskId: t.taskId,
      title: t.dueDate < today ? `${t.title} đã quá hạn` : `${t.title} sắp đến hạn`,
      body: `Deadline ${t.dueDate === today ? 'hôm nay' : t.dueDate === tomorrow ? 'ngày mai' : 'ngày'}, ${shortDate(t.dueDate)}. Còn ${duration(t.remainingMinutes)} cần thực hiện.`,
    }));
  for (const s of [...sessionsToday].sort((a, b) => a.startMinute - b.startMinute)) {
    if (nowMinute < s.startMinute - SESSION_LEAD_MINUTES || nowMinute >= s.startMinute + s.minutes) continue;
    list.push({
      kind: 'session',
      dedupeKey: `session:${s.sessionId}:${today}:${s.startMinute}`,
      taskId: null,
      title: nowMinute < s.startMinute ? `Sắp đến phiên học: ${s.title}` : `Đang trong giờ học: ${s.title}`,
      body: `${clock(s.startMinute)} – ${clock(s.startMinute + s.minutes)}, ${duration(s.minutes)}.`,
    });
  }
  if (pendingSessionsToday > 0) {
    list.push({
      kind: 'plan',
      dedupeKey: `plan:${today}`,
      taskId: null,
      title: `Hôm nay có ${pendingSessionsToday} phiên học`,
      body: 'Nhớ dành thời gian nghỉ giữa các phiên nhé.',
    });
  }
  return list;
}
