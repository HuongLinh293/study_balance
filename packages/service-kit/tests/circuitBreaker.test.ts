import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CircuitBreaker, CircuitOpenError } from '../src/circuitBreaker.js';
import { metrics } from '../src/metrics.js';

const fail = () => Promise.reject(new Error('down'));
const ok = () => Promise.resolve('ok');

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('opens after N consecutive failures and then fails fast', async () => {
  const c = clock();
  const b = new CircuitBreaker('t1', { failureThreshold: 3, resetTimeoutMs: 1000, now: c.now });
  let calls = 0;
  const counted = () => { calls++; return fail(); };
  for (let i = 0; i < 3; i++) await assert.rejects(b.exec(counted), /down/);
  assert.equal(b.state, 'open');
  await assert.rejects(b.exec(counted), CircuitOpenError);
  assert.equal(calls, 3, 'open circuit must not call the dependency');
});

test('a success resets the consecutive failure count', async () => {
  const b = new CircuitBreaker('t2', { failureThreshold: 3 });
  await assert.rejects(b.exec(fail));
  await assert.rejects(b.exec(fail));
  assert.equal(await b.exec(ok), 'ok');
  await assert.rejects(b.exec(fail));
  await assert.rejects(b.exec(fail));
  assert.equal(b.state, 'closed');
});

test('half-open: one trial call; success closes, failure reopens', async () => {
  const c = clock();
  const b = new CircuitBreaker('t3', { failureThreshold: 1, resetTimeoutMs: 1000, now: c.now });
  await assert.rejects(b.exec(fail));
  assert.equal(b.state, 'open');
  c.advance(999);
  await assert.rejects(b.exec(ok), CircuitOpenError);
  c.advance(1);
  await assert.rejects(b.exec(fail), /down/);
  assert.equal(b.state, 'open', 'failed trial reopens');
  c.advance(1000);
  let release!: () => void;
  const slow = b.exec(() => new Promise<string>((r) => { release = () => r('ok'); }));
  assert.equal(b.state, 'half_open');
  await assert.rejects(b.exec(ok), CircuitOpenError, 'only one trial at a time');
  release();
  assert.equal(await slow, 'ok');
  assert.equal(b.state, 'closed');
});

test('errors that are not dependency failures do not open the circuit', async () => {
  class ClientError extends Error {}
  const b = new CircuitBreaker('t4', { failureThreshold: 1, isFailure: (e) => !(e instanceof ClientError) });
  await assert.rejects(b.exec(() => Promise.reject(new ClientError('404'))));
  assert.equal(b.state, 'closed');
});

test('state and rejections are exported as Prometheus metrics', async () => {
  const b = new CircuitBreaker('t5', { failureThreshold: 1 });
  await assert.rejects(b.exec(fail));
  await assert.rejects(b.exec(ok), CircuitOpenError);
  const text = await metrics.metrics();
  assert.match(text, /studybalance_circuit_state\{circuit="t5"\} 2/);
  assert.match(text, /studybalance_circuit_rejections_total\{circuit="t5"\} 1/);
});
