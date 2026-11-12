/**
 * Worker thread: runs the CPU-heavy planning engine so the service's event loop
 * stays free for HTTP requests, health checks and RabbitMQ deliveries.
 */
import { parentPort } from 'node:worker_threads';
import { generatePlan, simulateBusy } from '../sessions/rules.js';
import type { PlannerJob } from './jobs.js';
import type { WorkerReply } from './workerPool.js';

const run = (job: PlannerJob) =>
  job.kind === 'generate' ? generatePlan(job.ctx, job.tasks) : simulateBusy(job.ctx, job.busy, job.tasks);

parentPort!.on('message', ({ id, input }: { id: number; input: PlannerJob }) => {
  let reply: WorkerReply<unknown>;
  try {
    reply = { id, ok: true, result: run(input) };
  } catch (error) {
    reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  parentPort!.postMessage(reply);
});
