import { addDays } from '@studybalance/service-kit';

export interface ReminderTask {
  taskId: string;
  title: string;
  dueDate: string;
  remainingMinutes: number;
}
export interface Reminder {
  kind: 'deadline' | 'plan';
  /** Unique per user: the same reminder is never stored twice, even with several schedulers. */
  dedupeKey: string;
  taskId: string | null;
  title: string;
  body: string;
}
const shortDate = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;
const duration = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}p` : ''}` : `${minutes} phút`;

/** Reminders due for one user on `today` (their local date). */
export function remindersFor(today: string, tasks: ReminderTask[], pendingSessionsToday: number): Reminder[] {
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
