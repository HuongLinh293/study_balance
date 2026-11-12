import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * One Prometheus registry per process. Every series carries `service`; the
 * scrape adds `instance`, so replicas of the same service stay distinct.
 */
export const metrics = new Registry();
let initialised = false;

export function initMetrics(service: string) {
  if (initialised) return;
  initialised = true;
  metrics.setDefaultLabels({ service });
  collectDefaultMetrics({ register: metrics });
}

export const httpRequestDuration = new Histogram({
  name: 'studybalance_http_request_duration_seconds',
  help: 'HTTP request duration by route template and status code',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metrics],
});

export const eventsConsumed = new Counter({
  name: 'studybalance_events_consumed_total',
  help: 'Events received from RabbitMQ by outcome (processed, duplicate, retry, dead_lettered, malformed, ignored)',
  labelNames: ['event_type', 'outcome'] as const,
  registers: [metrics],
});

export const eventsPublished = new Counter({
  name: 'studybalance_events_published_total',
  help: 'Outbox events confirmed by RabbitMQ',
  labelNames: ['event_type'] as const,
  registers: [metrics],
});

export const brokerConnected = new Gauge({
  name: 'studybalance_broker_connected',
  help: '1 while the RabbitMQ channel is open',
  registers: [metrics],
});

export const circuitState = new Gauge({
  name: 'studybalance_circuit_state',
  help: 'Circuit breaker state: 0 closed, 1 half-open, 2 open',
  labelNames: ['circuit'] as const,
  registers: [metrics],
});

export const circuitRejections = new Counter({
  name: 'studybalance_circuit_rejections_total',
  help: 'Calls failed fast because the circuit was open',
  labelNames: ['circuit'] as const,
  registers: [metrics],
});

export const streamConnections = new Gauge({
  name: 'studybalance_stream_connections',
  help: 'Open server-sent event streams',
  registers: [metrics],
});

/** Outbox rows not yet confirmed by the broker, read at scrape time. */
export function registerOutboxGauge(pending: () => Promise<number>) {
  if (metrics.getSingleMetric('studybalance_outbox_pending')) return;
  new Gauge({
    name: 'studybalance_outbox_pending',
    help: 'Outbox events waiting to be published',
    registers: [metrics],
    async collect() {
      this.set(await pending().catch(() => -1));
    },
  });
}
