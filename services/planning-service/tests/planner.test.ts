import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planner } from '../src/modules/planner/index.js';
import { generatePlan } from '../src/modules/sessions/rules.js';
import { bigInput } from './fixtures/bigPlan.js';

/** Longest gap between 10 ms timer ticks while `work` runs: how long the event loop was blocked. */
async function maxTimerGap(work: () => Promise<unknown> | unknown) {
  let last = performance.now();
  let gap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
  }, 10);
  await new Promise((r) => setTimeout(r, 20));
  last = performance.now();
  await work();
  await new Promise((r) => setTimeout(r, 20));
  clearInterval(timer);
  return gap;
}

test('worker result matches the engine run in-process', async () => {
  const a = bigInput(40);
  const direct = generatePlan(structuredClone(a.ctx), a.tasks);
  const viaWorker = await planner.generate(a.ctx, a.tasks);
  const shape = (r: typeof direct) => ({
    placed: r.placedMinutes,
    needed: r.neededMinutes,
    slots: r.proposed.map((s) => `${s.taskId}|${s.date}|${s.startMinute}|${s.minutes}`),
    shortfalls: r.shortfalls,
  });
  assert.deepEqual(shape(viaWorker), shape(direct));
});

test('the event loop stays responsive while a 500-task plan is computed', async () => {
  const blockedInProcess = await maxTimerGap(() => {
    const { ctx, tasks } = bigInput(500);
    generatePlan(ctx, tasks);
  });
  const blockedWithWorker = await maxTimerGap(() => {
    const { ctx, tasks } = bigInput(500);
    return planner.generate(ctx, tasks);
  });
  console.log(`  event loop blocked: in-process ${Math.round(blockedInProcess)} ms, worker ${Math.round(blockedWithWorker)} ms`);
  assert.ok(blockedInProcess > 300, 'the in-process run does block (sanity check of the measurement)');
  assert.ok(blockedWithWorker < 150, `worker run blocked the loop for ${Math.round(blockedWithWorker)} ms`);
});

test.after(() => planner.close());
