import type { TaskSnapshot } from '@studybalance/event-contracts';
import { exec, localNow, rows, upsertIfNewer, type EventHandlers, type PoolConnection } from '@studybalance/service-kit';

/**
 * Keeps the task's due date, and the user's local date on which it was first seen
 * done (cleared when reopened), so the on-time rate needs no call to task-service.
 */
async function projectTask(conn: PoolConnection, userId: string, taskId: string, version: number, task: TaskSnapshot, occurredAt: string) {
  await upsertIfNewer(conn, 'task_facts', 'task_id', {
    task_id: taskId,
    user_id: userId,
    subject_id: task.subjectId,
    due_date: task.dueDate,
    done: task.done,
    deleted: false,
    version,
  });
  const [prefs] = await rows<{ timezone: string }>(conn, 'SELECT timezone FROM preferences_projection WHERE user_id = ?', [userId]);
  await exec(
    conn,
    `UPDATE task_facts SET completed_on = CASE WHEN done = 0 THEN NULL ELSE COALESCE(completed_on, ?) END WHERE task_id = ?`,
    [localNow(prefs?.timezone, new Date(occurredAt)).date, taskId],
  );
}

export const handlers: EventHandlers = {
  TaskCreated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload, e.occurredAt),
  TaskUpdated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload, e.occurredAt),
  TaskProgressUpdated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload, e.occurredAt),
  TaskDeleted: async (conn, e) => {
    const [current] = await rows<{ version: number }>(conn, 'SELECT version FROM task_facts WHERE task_id = ? FOR UPDATE', [
      e.aggregateId,
    ]);
    if (current && current.version >= e.aggregateVersion) return;
    await exec(
      conn,
      `INSERT INTO task_facts (task_id, user_id, done, deleted, version) VALUES (?, ?, 0, 1, ?)
       ON DUPLICATE KEY UPDATE deleted = 1, version = VALUES(version)`,
      [e.aggregateId, e.userId, e.aggregateVersion],
    );
  },
  // Completed sessions are immutable facts; the session id makes repeated delivery harmless.
  StudySessionCompleted: (conn, e) =>
    exec(
      conn,
      'INSERT IGNORE INTO session_facts (session_id, user_id, task_id, date, actual_minutes, planned_minutes, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [e.aggregateId, e.userId, e.payload.taskId, e.payload.date, e.payload.actualMinutes, e.payload.plannedMinutes ?? null, new Date(e.occurredAt)],
    ).then(() => undefined),
  PreferencesUpdated: (conn, e) =>
    upsertIfNewer(conn, 'preferences_projection', 'user_id', {
      user_id: e.userId,
      timezone: e.payload.timezone,
      version: e.aggregateVersion,
    }),
};
