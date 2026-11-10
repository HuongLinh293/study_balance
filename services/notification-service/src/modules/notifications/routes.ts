import { Router } from 'express';
import { exec, notFound, parse, rows, userIdOf, z, type Pool } from '@studybalance/service-kit';

interface NotificationRow {
  id: string;
  kind: 'deadline' | 'plan';
  task_id: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}
const toNotification = (r: NotificationRow) => ({
  id: r.id,
  kind: r.kind,
  taskId: r.task_id,
  title: r.title,
  body: r.body,
  createdAt: r.created_at,
  read: r.read_at !== null,
});
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
const idParam = z.object({ id: z.uuid() });

export function notificationsRouter(pool: Pool) {
  const router = Router();

  router.get('/notifications', async (req, res) => {
    const { limit } = parse(listSchema, req.query);
    const userId = userIdOf(res);
    const list = await rows<NotificationRow>(
      pool,
      `SELECT id, kind, task_id, title, body, created_at, read_at FROM notifications
        WHERE user_id = ? ORDER BY read_at IS NOT NULL, created_at DESC, id LIMIT ?`,
      [userId, limit],
    );
    const [{ n }] = await rows<{ n: number }>(
      pool,
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
      [userId],
    );
    res.json({ items: list.map(toNotification), unreadCount: n });
  });

  router.patch('/notifications/:id/read', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const result = await exec(
      pool,
      'UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP(3)) WHERE id = ? AND user_id = ?',
      [id, userIdOf(res)],
    );
    if (!result.affectedRows) throw notFound('Notification');
    res.status(204).end();
  });

  router.post('/notifications/read-all', async (_req, res) => {
    await exec(pool, 'UPDATE notifications SET read_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND read_at IS NULL', [
      userIdOf(res),
    ]);
    res.status(204).end();
  });

  return router;
}
