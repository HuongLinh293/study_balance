import { randomUUID } from 'node:crypto';
import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage, type RecoveringChannelModel } from 'amqplib';
import {
  DEAD_LETTER_EXCHANGE,
  EVENTS_EXCHANGE,
  SCHEMA_VERSION,
  type DomainEvent,
  type EventPayloads,
  type EventType,
} from '@studybalance/event-contracts';
import { exec, isDuplicateKey, rows, withTransaction, type Pool, type PoolConnection } from './db.js';
import { errorMessage, type Logger } from './log.js';
import { brokerConnected, eventsConsumed, eventsPublished, registerOutboxGauge } from './metrics.js';

export const MAX_DELIVERY_ATTEMPTS = 5;
export const RETRY_DELAY_MS = 5000;

export type EventHandler<T extends EventType = EventType> = (conn: PoolConnection, event: DomainEvent<T>) => Promise<void>;
export type EventHandlers = { [T in EventType]?: EventHandler<T> };

interface ConsumerSpec {
  queue: string;
  handlers: EventHandlers;
  pool: Pool;
}

/**
 * RabbitMQ connection with automatic reconnect. Topology and consumers are
 * declared again after every reconnect; publishing uses publisher confirms.
 */
export class Broker {
  private connection?: RecoveringChannelModel;
  private channel: ConfirmChannel | null = null;
  private consumers: ConsumerSpec[] = [];

  constructor(
    private readonly url: string,
    private readonly service: string,
    private readonly log: Logger,
  ) {}

  /** Register before start(): one durable queue per consuming service. */
  consume(pool: Pool, handlers: EventHandlers) {
    this.consumers.push({ queue: `${this.service}.events`, handlers, pool });
  }

  async start() {
    this.connection = await amqp.connect(this.url, {
      recovery: {
        initialDelay: 500,
        maxDelay: 10_000,
        waitForConnect: false,
        setup: async (model: ChannelModel) => this.setup(model),
      },
    });
    this.connection.on('connect', () => this.log.info('broker_connected'));
    this.connection.on('disconnect', (error: Error) => {
      this.channel = null;
      brokerConnected.set(0);
      this.log.warn('broker_disconnected', { error: error.message });
    });
    this.connection.on('reconnect-scheduled', ({ attempt, delay }: { attempt: number; delay: number }) =>
      this.log.warn('broker_reconnect_scheduled', { attempt, delay }),
    );
    this.connection.on('error', (error: Error) => this.log.error('broker_error', { error: error.message }));
  }

  get connected() {
    return this.channel !== null;
  }

  async close() {
    this.channel = null;
    brokerConnected.set(0);
    await this.connection?.close().catch(() => undefined);
  }

  async publish(event: DomainEvent) {
    const channel = this.channel;
    if (!channel) throw new Error('Broker channel is not available');
    channel.publish(EVENTS_EXCHANGE, event.eventType, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
      type: event.eventType,
      correlationId: event.correlationId,
    });
    await channel.waitForConfirms();
  }

  private async setup(model: ChannelModel) {
    const channel = await model.createConfirmChannel();
    channel.on('error', (error: Error) => this.log.error('broker_channel_error', { error: error.message }));
    channel.on('close', () => {
      if (this.channel === channel) {
        this.channel = null;
        brokerConnected.set(0);
      }
    });
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
    for (const spec of this.consumers) await this.startConsumer(channel, spec);
    this.channel = channel;
    brokerConnected.set(1);
  }

  private async startConsumer(channel: ConfirmChannel, spec: ConsumerSpec) {
    const { queue } = spec;
    const dlq = `${queue}.dlq`;
    const retry = `${queue}.retry`;
    // Rejected messages go to the DLQ; retries wait in a TTL queue, then return to the main queue.
    await channel.assertQueue(queue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE, 'x-dead-letter-routing-key': dlq },
    });
    await channel.assertQueue(dlq, { durable: true });
    await channel.bindQueue(dlq, DEAD_LETTER_EXCHANGE, dlq);
    await channel.assertQueue(retry, {
      durable: true,
      arguments: {
        'x-message-ttl': RETRY_DELAY_MS,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queue,
      },
    });
    for (const eventType of Object.keys(spec.handlers)) await channel.bindQueue(queue, EVENTS_EXCHANGE, eventType);
    await channel.prefetch(10);
    await channel.consume(queue, (msg) => {
      if (msg) void this.handle(channel, spec, msg);
    });
  }

  private async handle(channel: ConfirmChannel, spec: ConsumerSpec, msg: ConsumeMessage) {
    let event: DomainEvent;
    try {
      event = JSON.parse(msg.content.toString('utf8'));
      if (typeof event.eventId !== 'string' || typeof event.eventType !== 'string') throw new Error('Bad envelope');
    } catch {
      this.log.error('event_rejected', { reason: 'malformed', messageId: msg.properties.messageId });
      eventsConsumed.inc({ event_type: 'unknown', outcome: 'malformed' });
      channel.nack(msg, false, false);
      return;
    }
    const handler = spec.handlers[event.eventType as EventType] as EventHandler | undefined;
    try {
      if (handler) {
        const started = performance.now();
        const outcome = await processOnce(spec.pool, event, handler);
        // correlationId links this to the HTTP request that caused it, across services.
        const fields = { eventId: event.eventId, eventType: event.eventType, correlationId: event.correlationId };
        if (outcome === 'duplicate') this.log.info('event_duplicate_skipped', fields);
        else this.log.info('event_processed', { ...fields, ms: Math.round(performance.now() - started) });
        eventsConsumed.inc({ event_type: event.eventType, outcome });
      } else {
        eventsConsumed.inc({ event_type: event.eventType, outcome: 'ignored' });
      }
      channel.ack(msg);
    } catch (error) {
      const attempt = Number(msg.properties.headers?.['x-attempt'] ?? 0) + 1;
      const fields = { eventId: event.eventId, eventType: event.eventType, attempt, error: errorMessage(error) };
      try {
        if (attempt >= MAX_DELIVERY_ATTEMPTS) {
          this.log.error('event_dead_lettered', fields);
          eventsConsumed.inc({ event_type: event.eventType, outcome: 'dead_lettered' });
          channel.nack(msg, false, false);
          return;
        }
        this.log.warn('event_retry_scheduled', fields);
        channel.sendToQueue(`${spec.queue}.retry`, msg.content, {
          ...msg.properties,
          persistent: true,
          headers: { ...msg.properties.headers, 'x-attempt': attempt },
        });
        await channel.waitForConfirms();
        channel.ack(msg);
        eventsConsumed.inc({ event_type: event.eventType, outcome: 'retry' });
      } catch (retryError) {
        // Channel is gone: the broker redelivers the unacked message after reconnect.
        this.log.error('event_retry_failed', { ...fields, retryError: errorMessage(retryError) });
      }
    }
  }
}

/** Inbox: record eventId and apply the effect in one local transaction. */
export async function processOnce(pool: Pool, event: DomainEvent, handler: EventHandler) {
  return withTransaction(pool, async (conn) => {
    try {
      await exec(conn, 'INSERT INTO processed_events (event_id, event_type) VALUES (?, ?)', [event.eventId, event.eventType]);
    } catch (error) {
      if (isDuplicateKey(error)) return 'duplicate' as const;
      throw error;
    }
    await handler(conn, event);
    return 'processed' as const;
  });
}

export function makeEvent<T extends EventType>(
  producer: string,
  eventType: T,
  fields: {
    aggregateId: string;
    aggregateVersion: number;
    userId: string;
    correlationId?: string;
    payload: EventPayloads[T];
  },
): DomainEvent<T> {
  return {
    eventId: randomUUID(),
    eventType,
    schemaVersion: SCHEMA_VERSION,
    occurredAt: new Date().toISOString(),
    producer,
    aggregateId: fields.aggregateId,
    aggregateVersion: fields.aggregateVersion,
    userId: fields.userId,
    correlationId: fields.correlationId ?? randomUUID(),
    payload: fields.payload,
  };
}

/** Transactional outbox: call inside the same transaction as the state change. */
export async function enqueueEvent(conn: PoolConnection, event: DomainEvent) {
  await exec(conn, 'INSERT INTO outbox (event_id, event_type, body) VALUES (?, ?, ?)', [
    event.eventId,
    event.eventType,
    JSON.stringify(event),
  ]);
}

/**
 * Moves outbox rows to the broker. A row is marked published only after the
 * broker confirms, so an event may be published more than once (at-least-once).
 * SKIP LOCKED lets several replicas relay without sending the same batch together.
 */
export function startOutboxRelay(pool: Pool, broker: Broker, log: Logger, intervalMs = 500) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let ticks = 0;
  registerOutboxGauge(async () => {
    const [row] = await rows<{ n: number }>(pool, 'SELECT COUNT(*) AS n FROM outbox WHERE published_at IS NULL');
    return Number(row.n);
  });
  const tick = async () => {
    if (broker.connected) {
      try {
        await withTransaction(pool, async (conn) => {
          const pending = await rows<{ id: number; body: DomainEvent | string }>(
            conn,
            'SELECT id, body FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED',
          );
          for (const row of pending) {
            const event = typeof row.body === 'string' ? (JSON.parse(row.body) as DomainEvent) : row.body;
            try {
              await broker.publish(event);
            } catch (error) {
              await exec(conn, 'UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', [row.id]);
              log.warn('outbox_publish_failed', { eventId: event.eventId, error: errorMessage(error) });
              break;
            }
            await exec(conn, 'UPDATE outbox SET published_at = CURRENT_TIMESTAMP(3), attempts = attempts + 1 WHERE id = ?', [row.id]);
            eventsPublished.inc({ event_type: event.eventType });
          }
        });
        if (++ticks % 7200 === 0) {
          await exec(pool, 'DELETE FROM outbox WHERE published_at < CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY');
        }
      } catch (error) {
        log.error('outbox_relay_failed', { error: errorMessage(error) });
      }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
