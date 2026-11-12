import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PoolBusyError, PoolTimeoutError, WorkerCrashedError, WorkerPool } from '../src/modules/planner/workerPool.js';

type In = { value?: number; sleepMs?: number; hang?: boolean; crash?: boolean; fail?: string };
const script = new URL('./fixtures/testWorker.ts', import.meta.url);
const make = (o: Partial<{ size: number; timeoutMs: number; maxQueue: number }> = {}) =>
  new WorkerPool<In, number>(script, { size: 2, timeoutMs: 2000, maxQueue: 10, ...o });

test('runs jobs in parallel on separate threads', async () => {
  const pool = make({ size: 2 });
  try {
    const started = performance.now();
    const results = await Promise.all([pool.run({ value: 1, sleepMs: 300 }), pool.run({ value: 2, sleepMs: 300 })]);
    assert.deepEqual(results, [2, 4]);
    assert.ok(performance.now() - started < 550, 'two 300 ms jobs on two workers finish together');
  } finally {
    await pool.close();
  }
});

test('queues beyond the pool size and rejects beyond maxQueue (backpressure)', async () => {
  const pool = make({ size: 1, maxQueue: 1 });
  try {
    const first = pool.run({ value: 1, sleepMs: 200 });
    const second = pool.run({ value: 2 });
    assert.equal(pool.queued, 1);
    await assert.rejects(pool.run({ value: 3 }), PoolBusyError);
    assert.deepEqual(await Promise.all([first, second]), [2, 4]);
  } finally {
    await pool.close();
  }
});

test('a job that never ends times out, and its worker is replaced', async () => {
  const pool = make({ size: 1, timeoutMs: 1000 });
  try {
    await assert.rejects(pool.run({ hang: true }), PoolTimeoutError);
    assert.equal(await pool.run({ value: 5 }), 10, 'the fresh worker serves the next job');
  } finally {
    await pool.close();
  }
});

test('a crashing worker fails only its job and is replaced', async () => {
  const pool = make({ size: 1 });
  try {
    await assert.rejects(pool.run({ crash: true }), WorkerCrashedError);
    assert.equal(await pool.run({ value: 7 }), 14);
  } finally {
    await pool.close();
  }
});

test('an error reported by the job is passed through; the worker stays', async () => {
  const pool = make({ size: 1 });
  try {
    await assert.rejects(pool.run({ fail: 'bad input' }), /bad input/);
    assert.equal(await pool.run({ value: 1 }), 2);
  } finally {
    await pool.close();
  }
});
