import type { Response } from 'express';
import { streamConnections } from '@studybalance/service-kit';

/**
 * Server-sent events: each open stream belongs to one user. A `notifications`
 * event only says "your list changed"; the client then refetches it through the
 * normal REST endpoint, so the stream never carries data the API would not.
 *
 * Streams live in this process. With several notification-service replicas a
 * shared channel (e.g. a RabbitMQ fanout) would be needed to reach every stream.
 */
export class NotificationHub {
  private readonly clients = new Map<string, Set<Response>>();

  constructor(
    private readonly heartbeatMs = 25_000,
    private readonly maxPerUser = 5,
  ) {}

  /** Starts a stream that ends at `closeAt` (token expiry); the client then reconnects. */
  open(userId: string, res: Response, closeAt: number) {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Nginx must pass events through immediately instead of buffering them.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\nevent: ready\ndata: {}\n\n');

    let set = this.clients.get(userId);
    if (!set) this.clients.set(userId, (set = new Set()));
    set.add(res);
    streamConnections.inc();
    // A user with many tabs keeps the newest streams.
    if (set.size > this.maxPerUser) set.values().next().value?.end();

    const ping = setInterval(() => res.write(': ping\n\n'), this.heartbeatMs);
    const expire = setTimeout(() => res.end(), Math.max(0, closeAt - Date.now()));
    res.on('close', () => {
      clearInterval(ping);
      clearTimeout(expire);
      if (set.delete(res)) streamConnections.dec();
      if (!set.size && this.clients.get(userId) === set) this.clients.delete(userId);
    });
  }

  publish(userId: string) {
    for (const res of this.clients.get(userId) ?? []) res.write('event: notifications\ndata: {}\n\n');
  }

  connections(userId?: string) {
    if (userId) return this.clients.get(userId)?.size ?? 0;
    let n = 0;
    for (const set of this.clients.values()) n += set.size;
    return n;
  }

  /** On shutdown: end streams so the HTTP server can close; clients reconnect elsewhere. */
  closeAll() {
    for (const set of this.clients.values()) for (const res of set) res.end();
  }
}

export const hub = new NotificationHub();
