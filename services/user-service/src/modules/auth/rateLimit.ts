/**
 * Fixed-window counter of failed logins per key. In-memory, so the limit is
 * per replica; a shared store is needed when user-service is scaled out.
 */
export function createFailureLimiter(maxFailures: number, windowMs: number) {
  const failures = new Map<string, { count: number; resetAt: number }>();
  return {
    retryAfterSeconds(key: string, now = Date.now()): number {
      const entry = failures.get(key);
      if (!entry || entry.resetAt <= now) return 0;
      return entry.count >= maxFailures ? Math.ceil((entry.resetAt - now) / 1000) : 0;
    },
    fail(key: string, now = Date.now()) {
      const entry = failures.get(key);
      if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + windowMs });
      else entry.count++;
      if (failures.size > 10_000) {
        for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
      }
    },
    reset(key: string) {
      failures.delete(key);
    },
  };
}
