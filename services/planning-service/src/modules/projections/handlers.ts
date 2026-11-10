import type { TaskSnapshot } from '@studybalance/event-contracts';
import { exec, rows, upsertIfNewer, type EventHandlers, type PoolConnection } from '@studybalance/service-kit';
import { emitSession, findSession } from '../sessions/repository.js';

async function projectTask(conn: PoolConnection, userId: string, taskId: string, version: number, task: TaskSnapshot) {
  await upsertIfNewer(conn, 'task_projection', 'task_id', {
    task_id: taskId,
    user_id: userId,
    subject_id: task.subjectId,
    due_date: task.dueDate,
    remaining_minutes: task.remainingMinutes,
    done: task.done,
    priority: task.priority,
    deleted: false,
    version,
  });
}

export const handlers: EventHandlers = {
  TaskCreated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
  TaskUpdated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
  TaskProgressUpdated: (conn, e) => projectTask(conn, e.userId, e.aggregateId, e.aggregateVersion, e.payload),
  // Tombstone: cancel planned sessions of the task; finished sessions stay as history.
  TaskDeleted: async (conn, e) => {
    const [current] = await rows<{ version: number }>(conn, 'SELECT version FROM task_projection WHERE task_id = ? FOR UPDATE', [
      e.aggregateId,
    ]);
    if (current && current.version >= e.aggregateVersion) return;
    await exec(
      conn,
      `INSERT INTO task_projection (task_id, user_id, due_date, remaining_minutes, done, deleted, version)
       VALUES (?, ?, '1970-01-01', 0, 1, 1, ?)
       ON DUPLICATE KEY UPDATE deleted = 1, version = VALUES(version)`,
      [e.aggregateId, e.userId, e.aggregateVersion],
    );
    const planned = await rows<{ id: string }>(
      conn,
      "SELECT id FROM study_sessions WHERE task_id = ? AND user_id = ? AND status = 'planned' FOR UPDATE",
      [e.aggregateId, e.userId],
    );
    for (const { id } of planned) {
      const session = (await findSession(conn, e.userId, id))!;
      await exec(conn, 'DELETE FROM study_sessions WHERE id = ?', [id]);
      await emitSession(conn, e.userId, { ...session, version: session.version + 1 }, e.correlationId, true);
    }
  },
  PreferencesUpdated: (conn, e) =>
    upsertIfNewer(conn, 'preferences_projection', 'user_id', {
      user_id: e.userId,
      rest_minutes: e.payload.restMinutes,
      daily_limit_minutes: e.payload.dailyLimitMinutes,
      session_minutes: e.payload.sessionMinutes,
      timezone: e.payload.timezone,
      version: e.aggregateVersion,
    }),
  AvailabilityUpdated: (conn, e) =>
    upsertIfNewer(conn, 'availability_projection', 'user_id', {
      user_id: e.userId,
      windows: JSON.stringify(e.payload.windows),
      busy: JSON.stringify(e.payload.busy.map(({ date, startMinute, endMinute }) => ({ date, startMinute, endMinute }))),
      version: e.aggregateVersion,
    }),
};
