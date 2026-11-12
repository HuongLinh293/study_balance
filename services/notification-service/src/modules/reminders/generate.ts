import { randomUUID } from 'node:crypto';
import { addDays, afterCommit, errorMessage, exec, localNow, rows, type Db, type Logger, type Pool } from '@studybalance/service-kit';
import { hub } from '../notifications/stream.js';
import { remindersFor, type ReminderTask } from './rules.js';

/**
 * Brings one user's reminders in line with the current projections: inserts
 * missing ones (unique dedupe key), refreshes the text of unread ones, and removes
 * unread reminders that no longer apply (task done, deleted, deadline moved, plan emptied).
 * Open streams of the user are told once the change is committed.
 */
export async function syncReminders(db: Db, userId: string, now = new Date()) {
  const [prefs] = await rows<{ reminders: number; timezone: string }>(
    db,
    'SELECT reminders, timezone FROM preferences_projection WHERE user_id = ?',
    [userId],
  );
  const enabled = prefs ? Boolean(prefs.reminders) : true;
  const today = localNow(prefs?.timezone, now).date;
  const desired = enabled
    ? remindersFor(
        today,
        (
          await rows<{ task_id: string; title: string; due_date: string; remaining_minutes: number }>(
            db,
            'SELECT task_id, title, due_date, remaining_minutes FROM task_projection WHERE user_id = ? AND done = 0 AND deleted = 0 AND due_date <= ?',
            [userId, addDays(today, 1)],
          )
        ).map<ReminderTask>((t) => ({ taskId: t.task_id, title: t.title, dueDate: t.due_date, remainingMinutes: t.remaining_minutes })),
        (
          await rows<{ n: number }>(
            db,
            "SELECT COUNT(*) AS n FROM session_projection WHERE user_id = ? AND date = ? AND status = 'planned' AND deleted = 0",
            [userId, today],
          )
        )[0].n,
      )
    : [];
  const removed = await exec(
    db,
    `DELETE FROM notifications WHERE user_id = ? AND read_at IS NULL${desired.length ? ' AND dedupe_key NOT IN (?)' : ''}`,
    desired.length ? [userId, desired.map((r) => r.dedupeKey)] : [userId],
  );
  let changed = removed.affectedRows > 0;
  // Unread reminders follow the data (e.g. "Còn 1h" after a session was logged);
  // read ones stay as the user saw them.
  const existing = new Map(
    (
      await rows<{ dedupe_key: string; title: string; body: string; read_at: string | null }>(
        db,
        'SELECT dedupe_key, title, body, read_at FROM notifications WHERE user_id = ?',
        [userId],
      )
    ).map((n) => [n.dedupe_key, n]),
  );
  for (const r of desired) {
    const current = existing.get(r.dedupeKey);
    if (!current) {
      const inserted = await exec(
        db,
        'INSERT IGNORE INTO notifications (id, user_id, kind, dedupe_key, task_id, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), userId, r.kind, r.dedupeKey, r.taskId, r.title, r.body],
      );
      if (inserted.affectedRows) changed = true;
    } else if (current.read_at === null && (current.title !== r.title || current.body !== r.body)) {
      await exec(db, 'UPDATE notifications SET title = ?, body = ? WHERE user_id = ? AND dedupe_key = ? AND read_at IS NULL', [
        r.title,
        r.body,
        userId,
        r.dedupeKey,
      ]);
      changed = true;
    }
  }
  if (changed) afterCommit(db, () => hub.publish(userId));
  return changed;
}

/** Periodic pass for date rollover (a task becomes "due tomorrow" without any event). */
export function startReminderScheduler(pool: Pool, log: Logger, intervalMs = 60_000) {
  const run = async () => {
    try {
      const users = await rows<{ user_id: string }>(
        pool,
        `SELECT user_id FROM task_projection WHERE done = 0 AND deleted = 0
         UNION SELECT user_id FROM session_projection WHERE status = 'planned' AND deleted = 0`,
      );
      for (const { user_id } of users) await syncReminders(pool, user_id);
    } catch (error) {
      log.error('reminder_scheduler_failed', { error: errorMessage(error) });
    }
  };
  void run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
