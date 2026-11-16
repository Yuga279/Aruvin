/**
 * ============================================================================
 * FILE: attempt-limiter.spec.ts
 * LOCATION: backend/test/auth/attempt-limiter.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify finite login/recovery attempt admission and key cardinality.
 *
 * ROLE IN PROJECT:
 *    Proves process-local rate limits without timers, eviction of live keys,
 *    or account-existence signaling.
 *
 * KEY COMPONENTS:
 *    - take: Per-email login (10) and recovery (3) windows.
 *    - takeGlobal: Process-wide mutation ceiling and prune-on-expiry.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { AttemptLimiter } from '../../src/auth/attempt-limiter.js';
it('limits normalized email and prunes only expired keys', () => {
  let now = 0; const limiter = new AttemptLimiter(() => now);
  for (let n = 0; n < 10; n++) limiter.take('login', 'a@example.com');
  expect(() => limiter.take('login', 'a@example.com')).toThrow('RATE_LIMITED');
  for (let n = 0; n < 3; n++) limiter.take('recovery', 'b@example.com');
  expect(() => limiter.take('recovery', 'b@example.com')).toThrow('RATE_LIMITED');
  now = 60000; expect(() => limiter.take('login', 'a@example.com')).not.toThrow();
});
it('bounds global traffic and live key cardinality without eviction', () => {
  let now = 0; const limiter = new AttemptLimiter(() => now);
  for (let n = 0; n < 60; n++) limiter.takeGlobal();
  expect(() => limiter.takeGlobal()).toThrow('RATE_LIMITED');
  for (let n = 0; n < 1024; n++) limiter.take('login', `u${n}@example.com`);
  expect(() => limiter.take('login', 'new@example.com')).toThrow('RATE_LIMITED');
  now += 60000;
  expect(() => limiter.takeGlobal()).not.toThrow();
  expect(() => limiter.take('login', 'new@example.com')).not.toThrow();
});
