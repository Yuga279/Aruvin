/**
 * ============================================================================
 * FILE: native-preflight.spec.ts
 * LOCATION: backend/test/performance/native-preflight.spec.ts
 * PURPOSE: Print an operator-safe offline prerequisite report, not readiness proof.
 * ROLE IN PROJECT: Imports only the driver-free authorization/measurement helper;
 *    never reads URI contents, constructs clients or contacts services, even enabled.
 * KEY COMPONENTS: Explicitly selected no-connect prerequisite report.
 * ============================================================================
 */
import { expect, it } from 'vitest';
import { nativePreflight } from './native-safety.js';

it('prints secret-safe offline native prerequisite report (not execution approval)', () => {
  const report = nativePreflight(process.env);
  console.log(JSON.stringify({ kind: 'native-offline-preflight', ...report }));
  expect(report.executionReady).toBe(false);
  expect(report.proposedPair).toEqual({ samplesPerSource: 1, databases: 12, turns: 54 });
});
