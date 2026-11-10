import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { createFailureLimiter } from '../src/modules/auth/rateLimit.js';

test('passwords are salted and verified without storing plaintext', async () => {
  const a = await hashPassword('correct horse');
  const b = await hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.ok(!a.includes('correct horse'));
  assert.equal(await verifyPassword('correct horse', a), true);
  assert.equal(await verifyPassword('wrong', a), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});
test('failed logins are limited per key within the window', () => {
  const limiter = createFailureLimiter(3, 1000);
  for (let i = 0; i < 3; i++) limiter.fail('k', 0);
  assert.ok(limiter.retryAfterSeconds('k', 10) > 0);
  assert.equal(limiter.retryAfterSeconds('other', 10), 0);
  assert.equal(limiter.retryAfterSeconds('k', 1001), 0);
  limiter.reset('k');
  assert.equal(limiter.retryAfterSeconds('k', 10), 0);
});
