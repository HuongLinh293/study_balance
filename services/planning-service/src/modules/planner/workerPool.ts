import { Worker } from 'node:worker_threads';

export class PoolBusyError extends Error {}
export class PoolTimeoutError extends Error {}
export class WorkerCrashedError extends Error {}

export interface WorkerPoolOptions {
  /** Worker threads kept alive. */
  size: number;
  /** A job running longer than this is abandoned: its worker is terminated and replaced. */
  timeoutMs: number;
  /** Jobs waiting for a free worker; beyond this, run() fails fast (backpressure). */
  maxQueue: number;
  onEvent?: (event: 'started' | 'replaced', fields: Record<string, unknown>) => void;
}

interface Job<J, R> {
  id: number;
  input: J;
  resolve: (result: R) => void;
  reject: (error: Error) => void;
}
interface Slot<J, R> {
  worker: Worker;
  job: Job<J, R> | null;
  timer?: NodeJS.Timeout;
}
/** Messages a worker script must send back for every `{ id, input }` it receives. */
export type WorkerReply<R> = { id: number; ok: true; result: R } | { id: number; ok: false; error: string };

/**
 * Fixed-size pool of worker threads for CPU-bound work, so the event loop keeps
 * serving HTTP, health checks and RabbitMQ while a job runs. Workers start on
 * first use; a crashed or timed-out worker is replaced before the next job.
 */
export class WorkerPool<J, R> {
  private readonly slots: Slot<J, R>[] = [];
  private readonly queue: Job<J, R>[] = [];
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly script: URL,
    private readonly options: WorkerPoolOptions,
  ) {}

  get queued() {
    return this.queue.length;
  }
  get running() {
    return this.slots.filter((s) => s.job).length;
  }

  run(input: J): Promise<R> {
    if (this.closed) return Promise.reject(new Error('Worker pool is closed'));
    if (!this.slots.length) for (let i = 0; i < this.options.size; i++) this.slots.push(this.spawn());
    const idle = this.slots.some((s) => !s.job);
    if (!idle && this.queue.length >= this.options.maxQueue) return Promise.reject(new PoolBusyError('All planner workers are busy'));
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ id: this.nextId++, input, resolve, reject });
      this.dispatch();
    });
  }

  async close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new Error('Worker pool is closed'));
    await Promise.all(
      this.slots.splice(0).map((s) => {
        clearTimeout(s.timer);
        s.job?.reject(new Error('Worker pool is closed'));
        return s.worker.terminate();
      }),
    );
  }

  private spawn(): Slot<J, R> {
    // Inherits the parent's execArgv, so a TypeScript loader used in dev/tests applies too.
    const worker = new Worker(this.script);
    worker.unref();
    const slot: Slot<J, R> = { worker, job: null };
    worker.on('message', (reply: WorkerReply<R>) => {
      const job = slot.job;
      if (!job || reply.id !== job.id) return;
      this.finish(slot);
      if (reply.ok) job.resolve(reply.result);
      else job.reject(new Error(reply.error));
      this.dispatch();
    });
    worker.on('error', (error) => this.fail(slot, new WorkerCrashedError(error.message)));
    worker.on('exit', (code) => {
      if (!this.closed) this.fail(slot, new WorkerCrashedError(`Worker exited with code ${code}`));
    });
    this.options.onEvent?.('started', { threadId: worker.threadId });
    return slot;
  }

  private dispatch() {
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.timer = setTimeout(
        () => this.fail(slot, new PoolTimeoutError(`Job took longer than ${this.options.timeoutMs} ms`)),
        this.options.timeoutMs,
      );
      slot.worker.postMessage({ id: job.id, input: job.input });
    }
  }

  private finish(slot: Slot<J, R>) {
    clearTimeout(slot.timer);
    slot.job = null;
  }

  /** The worker is in an unknown state: reject its job and put a fresh worker in its place. */
  private fail(slot: Slot<J, R>, error: Error) {
    const index = this.slots.indexOf(slot);
    if (index === -1 || this.closed) return;
    const job = slot.job;
    this.finish(slot);
    this.slots[index] = this.spawn();
    slot.worker.removeAllListeners();
    slot.worker.on('error', () => undefined);
    void slot.worker.terminate();
    this.options.onEvent?.('replaced', { threadId: slot.worker.threadId, reason: error.message });
    job?.reject(error);
    this.dispatch();
  }
}
