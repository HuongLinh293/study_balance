import type { TaskSnapshot } from '@studybalance/event-contracts';
import { exec, rows, upsertIfNewer, type EventHandlers, type PoolConnection } from '@studybalance/service-kit';

const projectTask = (conn: PoolConnection, userId: string, taskId: string, version: number, task: TaskSnapshot) =>
  upsertIfNewer(conn, 'task_facts', 'task_id', {
    task_id: taskId,
    user_id: userId,
    subject_id: task.subjectId,
    done: task.done,
    deleted: false,
    version,
  });

export const handlers: EventHandlers = {
  TaskCreated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
  TaskUpdated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
  TaskProgressUpdated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
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
      'INSERT IGNORE INTO session_facts (session_id, user_id, task_id, date, actual_minutes, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [e.aggregateId, e.userId, e.payload.taskId, e.payload.date, e.payload.actualMinutes, new Date(e.occurredAt)],
    ).then(() => undefined),
  PreferencesUpdated: (conn, e) =>
    upsertIfNewer(conn, 'preferences_projection', 'user_id', {
      user_id: e.userId,
      timezone: e.payload.timezone,
      version: e.aggregateVersion,
    }),
};
