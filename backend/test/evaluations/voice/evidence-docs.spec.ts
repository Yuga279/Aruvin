/**
 * ============================================================================
 * FILE: evidence-docs.spec.ts
 * LOCATION: backend/test/evaluations/voice/evidence-docs.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verification test for documentation integrity and acceptance traceability.
 *
 * ROLE IN PROJECT:
 *    Ensures verification.md, staging-evidence.md, and pilot-evaluation.md contain
 *    all required acceptance criteria (A1-A18), browser matrix rows, and do not
 *    contain false certification or unapproved review-pass claims.
 *
 * KEY COMPONENTS:
 *    - Acceptance criteria A1-A18 validation
 *    - Browser and pilot requirement checks
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const doc = (name: string) => readFileSync(new URL(`../../../../docs/voice-modes/${name}`, import.meta.url), 'utf8');
it('maps all scoped acceptance IDs without treating fixtures or deferred features as release passes', () => {
  const v = doc('verification.md'), s = doc('staging-evidence.md'), p = doc('pilot-evaluation.md');
  for (let i = 1; i <= 18; i++) expect(v).toMatch(new RegExp(`\\| A${i} \\|`));
  expect(v).toMatch(/\| A10 \|[^\n]*deferred/i);
  expect(v).toContain('Review: skipped');
  expect(v).toContain('CONFLICT_ACTIVE_TURN');
  expect(v).toContain('AURVIN_TEST_DB_PREFIX=aurvin_p2_test_');
  for (const browser of ['Chrome', 'Edge', 'Firefox', 'Safari', 'iOS Safari', 'Android Chrome']) expect(s).toContain(`| ${browser} |`);
  for (const target of ['100 utterances', '30 matched', '250 ms', '98%', 'false-interrupt tolerance', 'Haley', 'Alexis', 'Priya']) expect(p).toContain(target);
  expect(p).toContain('No paid calls authorized by this plan');
  expect(s).toMatch(/No real-device results recorded|## Recorded device results/);
  expect(v + s + p).not.toMatch(/review passed|production certified|fixtures certify hardware/i);
});
