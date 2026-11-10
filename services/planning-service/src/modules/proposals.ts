import { rows, type Db } from '@studybalance/service-kit';
import { openTasks } from './sessions/repository.js';

/** A preview older than this must be recomputed before applying. */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

/**
 * Everything a preview depended on: the user's sessions, preferences and
 * availability versions, and (for generated plans) open task versions.
 * Applying is refused when this changed, instead of overwriting newer edits.
 */
export async function fingerprint(
  db: Db,
  userId: string,
  today: string,
  versions: { prefs: number; availability: number },
  withTasks: boolean,
) {
  const sessions = await rows<{ id: string; version: number }>(
    db,
    "SELECT id, version FROM study_sessions WHERE user_id = ? AND (status = 'planned' OR date >= ?)",
    [userId, today],
  );
  const parts = [
    ...sessions.map((s) => `session:${s.id}:${s.version}`),
    `prefs:${versions.prefs}`,
    `availability:${versions.availability}`,
  ];
  if (withTasks) for (const t of await openTasks(db, userId, today)) parts.push(`task:${t.taskId}:${t.version}`);
  return parts.sort();
}
export const isExpired = (createdAt: string) =>
  Date.now() - new Date(`${createdAt.replace(' ', 'T')}Z`).getTime() > PREVIEW_TTL_MS;
export const sameBasis = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
