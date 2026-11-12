import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chart, estimateRatio, periodRange, streak } from '../src/modules/stats/summary.js';

test('week runs Monday to Sunday and marks today', () => {
  assert.deepEqual(periodRange('week', '2026-10-24'), { from: '2026-10-19', to: '2026-10-25' });
  const c = chart('week', '2026-10-24', new Map([['2026-10-24', 70], ['2026-10-19', 30]]));
  assert.deepEqual(c.values, [30, 0, 0, 0, 0, 70, 0]);
  assert.equal(c.current, 5);
});
test('month buckets by 7 days, including the partial last week', () => {
  assert.deepEqual(periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  const c = chart('month', '2026-10-24', new Map([['2026-10-24', 70], ['2026-10-31', 10]]));
  assert.deepEqual(c.values, [0, 0, 0, 70, 10]);
  assert.equal(c.current, 3);
});
test('streak counts back from today, or from yesterday before studying today', () => {
  const days = new Set(['2026-10-22', '2026-10-23']);
  assert.equal(streak('2026-10-24', days), 2);
  assert.equal(streak('2026-10-25', days), 0);
  assert.equal(streak('2026-10-23', days), 2);
});
test('estimate ratio compares actual with planned minutes', () => {
  assert.equal(estimateRatio(100, 120), 1.2);
  assert.equal(estimateRatio(0, 30), null);
});
