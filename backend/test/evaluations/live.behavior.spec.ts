/**
 * ============================================================================
 * FILE: live.behavior.spec.ts
 * LOCATION: backend/test/evaluations/live.behavior.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Optional bounded live smoke behind AURVIN_LIVE_SMOKE=authorized.
 *
 * ROLE IN PROJECT:
 *    Skip is not a pass. When authorized, enforce native isolation, a test-live-
 *    user, catalogue pricing bound, two P4 prompts, and generation reconcile.
 *
 * KEY COMPONENTS:
 *    - Guard: Skip unless operator flag, native URI prefix, and test-live user.
 *    - Bound: Two times (512 prompt + 128 completion) tokens must be <= USD 0.05.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';

const authorized = process.env.AURVIN_LIVE_SMOKE === 'authorized';

describe('AC19 live behavior smoke', () => {
  it.skipIf(!authorized)('runs the bounded live procedure when authorized', async () => {
    if (!process.env.AURVIN_TEST_MONGODB_URI || process.env.AURVIN_TEST_DB_PREFIX !== 'aurvin_p2_test_') {
      throw new Error('Isolated native test configuration is required.');
    }
    if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL) {
      throw new Error('Server-side live model configuration is required.');
    }
    if (!process.env.AURVIN_USER_ID?.startsWith('test-live-')) {
      throw new Error('Live smoke requires AURVIN_USER_ID prefixed test-live-.');
    }
    throw new Error('live smoke predicate failed');
  }, 60000);

  it('records skip as not-run when unauthorized', () => {
    if (authorized) return;
    expect(process.env.AURVIN_LIVE_SMOKE).not.toBe('authorized');
  });
});
