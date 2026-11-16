/**
 * ============================================================================
 * FILE: calendar-simplification-compatibility.spec.ts
 * LOCATION: backend/test/contracts/calendar-simplification-compatibility.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Freeze pre-P2 Calendar records and prove they still round-trip.
 *
 * ROLE IN PROJECT:
 *    Structural fixture compatibility for v1/v2 operations, receipts and
 *    checkpoint refs. Does not certify two binaries against a database.
 *
 * KEY COMPONENTS:
 *    - compatibleCalendarOperationSchema / receipt / checkpoint refs
 *    - legacyOperationDisposition remains historical, not executable authority
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { compatibleCalendarOperationSchema, compatibleCalendarReceiptSchema,
  compatibleCalendarCheckpointRefsSchema, legacyOperationDisposition }
  from '../../src/contracts/calendar-compatibility.js';
import { operationV1, receiptV1, at } from './calendar-multi-fixtures.js';

it('keeps pre-simplification records readable without converting history into authority', () => {
  const saved = JSON.parse(JSON.stringify({ ...operationV1, state: 'unknown' }));
  const decoded = compatibleCalendarOperationSchema.parse(saved);
  expect(compatibleCalendarOperationSchema.parse(JSON.parse(JSON.stringify(decoded)))).toEqual(decoded);
  expect(legacyOperationDisposition(decoded, at)).toMatchObject({ externalOutcome: 'unknown', reconcileOriginal: true });
  expect(compatibleCalendarReceiptSchema.parse(JSON.parse(JSON.stringify(receiptV1)))).toEqual(receiptV1);
  const refs = { version: 1, userId: 'u', sessionId: 's', turnId: 't', decisionIds: ['d'],
    toolCallIds: ['call'], operationId: 'op' };
  expect(compatibleCalendarCheckpointRefsSchema.parse(JSON.parse(JSON.stringify(refs)))).toEqual(refs);
});
