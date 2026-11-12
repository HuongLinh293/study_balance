import { availableParallelism } from 'node:os';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Counter, Gauge, HttpError, Histogram, createLogger, metrics } from '@studybalance/service-kit';
import type { PlanContext, TaskInfo } from '../sessions/rules.js';
import type { GenerateResult, PlannerJob, SimulateResult } from './jobs.js';
import { PoolBusyError, PoolTimeoutError, WorkerCrashedError, WorkerPool } from './workerPool.js';

const log = createLogger('planning-service');
const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const jobs = new Counter({
  name: 'studybalance_planner_jobs_total',
  help: 'Planner jobs by kind and outcome (ok, error, timeout, busy, crashed)',
  labelNames: ['kind', 'outcome'] as const,
  registers: [metrics],
});
const duration = new Histogram({
  name: 'studybalance_planner_job_duration_seconds',
  help: 'Time from submitting a planner job to its result, queueing included',
  labelNames: ['kind'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metrics],
});

// Compiled: worker.js next to this file. In dev/tests (tsx): worker.ts.
const script = new URL(`./worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
const pool = new WorkerPool<PlannerJob, GenerateResult | SimulateResult>(script, {
  size: envInt('PLANNER_WORKERS', Math.max(1, Math.min(2, availableParallelism() - 1))),
  timeoutMs: envInt('PLANNER_TIMEOUT_MS', 10_000),
  maxQueue: envInt('PLANNER_MAX_QUEUE', 50),
  onEvent: (event, fields) => log[event === 'replaced' ? 'warn' : 'info'](`planner_worker_${event}`, fields),
});
new Gauge({
  name: 'studybalance_planner_queue',
  help: 'Planner jobs waiting (state="queued") or running (state="running")',
  labelNames: ['state'] as const,
  registers: [metrics],
  collect() {
    this.set({ state: 'queued' }, pool.queued);
    this.set({ state: 'running' }, pool.running);
  },
});

async function submit<R>(job: PlannerJob): Promise<R> {
  const stop = duration.startTimer({ kind: job.kind });
  try {
    const result = (await pool.run(job)) as R;
    jobs.inc({ kind: job.kind, outcome: 'ok' });
    return result;
  } catch (error) {
    const outcome =
      error instanceof PoolBusyError ? 'busy'
      : error instanceof PoolTimeoutError ? 'timeout'
      : error instanceof WorkerCrashedError ? 'crashed'
      : 'error';
    jobs.inc({ kind: job.kind, outcome });
    if (outcome === 'busy') throw new HttpError(503, 'PLANNER_BUSY', 'The planner is busy, retry shortly');
    if (outcome === 'timeout') throw new HttpError(503, 'PLANNER_TIMEOUT', 'Planning took too long, retry with fewer tasks');
    throw error;
  } finally {
    stop();
  }
}

/** The planning engine, run in worker threads. */
export const planner = {
  generate: (ctx: PlanContext, tasks: TaskInfo[]) => submit<GenerateResult>({ kind: 'generate', ctx, tasks }),
  simulate: (ctx: PlanContext, busy: { date: string; startMinute: number; endMinute: number }, tasks: Map<string, TaskInfo>) =>
    submit<SimulateResult>({ kind: 'simulate', ctx, busy, tasks }),
  close: () => pool.close(),
};
