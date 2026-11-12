import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './errors.js';
import type { Logger } from './log.js';
import { httpRequestDuration, initMetrics, metrics } from './metrics.js';

const CORRELATION_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Express app with JSON body, correlation id, access log, metrics, /health, /ready and /metrics. */
export function createServiceApp(
  service: string,
  log: Logger,
  readiness: () => Promise<Record<string, boolean>>,
): Express {
  initMetrics(service);
  const instance = hostname();
  const app = express();
  app.disable('x-powered-by');
  // Behind the Nginx gateway (or Vite proxy in dev); used for client IP in rate limits.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    const incoming = req.header('x-correlation-id');
    const correlationId = incoming && CORRELATION_ID.test(incoming) ? incoming : randomUUID();
    res.locals.correlationId = correlationId;
    res.setHeader('X-Correlation-Id', correlationId);
    // Which replica answered: shows load balancing through the gateway.
    res.setHeader('X-Served-By', instance);
    const started = performance.now();
    res.on('finish', () => {
      if (req.path === '/health' || req.path === '/ready' || req.path === '/metrics') return;
      const ms = performance.now() - started;
      // Route template (/tasks/:id), not the raw path, keeps label cardinality bounded.
      const route = req.route ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
      // Event streams stay open for minutes; they would distort the latency histogram.
      const streaming = String(res.getHeader('content-type') ?? '').startsWith('text/event-stream');
      if (!streaming) httpRequestDuration.observe({ method: req.method, route, status: String(res.statusCode) }, ms / 1000);
      log.info('http_request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(ms),
        correlationId,
      });
    });
    next();
  });
  // Liveness: the process is running.
  app.get('/health', (_req, res) => {
    res.json({ service, status: 'ok' });
  });
  // Readiness: dependencies are reachable.
  app.get('/ready', async (_req, res) => {
    const checks = await readiness().catch(() => ({ readiness: false }));
    const ok = Object.values(checks).every(Boolean);
    res.status(ok ? 200 : 503).json({ service, status: ok ? 'ready' : 'not_ready', checks });
  });
  // Prometheus scrape endpoint; the gateway does not expose it.
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', metrics.contentType);
    res.send(await metrics.metrics());
  });
  return app;
}
export function finishApp(app: Express, log: Logger) {
  app.use(notFoundHandler);
  app.use(errorHandler(log.error));
}
export function listen(app: Express, port: number, log: Logger, onShutdown: () => Promise<void>) {
  const server = app.listen(port, '0.0.0.0', () => log.info('listening', { port }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      log.info('shutting_down', { signal });
      setTimeout(() => process.exit(1), 10_000).unref();
      server.close(() => {
        onShutdown()
          .catch(() => undefined)
          .finally(() => process.exit(0));
      });
    });
  }
  return server;
}
