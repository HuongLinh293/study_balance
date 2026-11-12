import type { TaskSnapshot } from '@studybalance/event-contracts';
import { exec, rows, upsertIfNewer, type EventHandlers, type PoolConnection } from '@studybalance/service-kit';
import { syncReminders } from './generate.js';

async function projectTask(conn: PoolConnection, userId: string, taskId: string, version: number, task: TaskSnapshot) {
  await upsertIfNewer(conn, 'task_projection', 'task_id', {
    task_id: taskId,
    user_id: userId,
    title: task.title,
    due_date: task.dueDate,
    remaining_minutes: task.remainingMinutes,
    done: task.done,
    deleted: false,
    version,
  });
  await syncReminders(conn, userId);
}

export const handlers: EventHandlers = {
  TaskCreated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
  TaskUpdated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
  TaskProgressUpdated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
  TaskDeleted: async (conn, e) => {
    const [current] = await rows<{ version: number }>(conn, 'SELECT version FROM task_projection WHERE task_id = ? FOR UPDATE', [
      e.aggregateId,
    ]);
    if (current && current.version >= e.aggregateVersion) return;
    await exec(
      conn,
      `INSERT INTO task_projection (task_id, user_id, title, due_date, remaining_minutes, done, deleted, version)
       VALUES (?, ?, '', '1970-01-01', 0, 1, 1, ?) ON DUPLICATE KEY UPDATE deleted = 1, version = VALUES(version)`,
      [e.aggregateId, e.userId, e.aggregateVersion],
    );
    await syncReminders(conn, e.userId);
  },
  StudySessionUpdated: async (conn, e) => {
    await upsertIfNewer(conn, 'session_projection', 'session_id', {
      session_id: e.aggregateId,
      user_id: e.userId,
      task_id: e.payload.taskId,
      date: e.payload.date,
      start_minute: e.payload.startMinute,
      minutes: e.payload.minutes,
      status: e.payload.status,
      deleted: e.payload.deleted,
      version: e.aggregateVersion,
    });
    await syncReminders(conn, e.userId);
  },
  PreferencesUpdated: async (conn, e) => {
    await upsertIfNewer(conn, 'preferences_projection', 'user_id', {
      user_id: e.userId,
      reminders: e.payload.reminders,
      timezone: e.payload.timezone,
      version: e.aggregateVersion,
    });
    await syncReminders(conn, e.userId);
  },
};
