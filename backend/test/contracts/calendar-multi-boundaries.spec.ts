/**
 * ============================================================================
 * FILE: calendar-multi-boundaries.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-boundaries.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify strict authority, ceiling, interval, and collection boundaries.
 *
 * ROLE IN PROJECT:
 *    Proves non-laundering of foreign properties, exact 100-calendar and
 *    256 KiB snapshot ceilings, free-window partition completeness, and
 *    selection-decision reply constraints.
 *
 * KEY COMPONENTS:
 *    - proposalMatchesReply selection vs accept decisions
 *    - calendarAvailabilityResultSchema partition coverage
 *    - snapshot and availability exact count/time/byte limits
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { COLLECTIONS } from '../../src/contracts/collections.js';
import { calendarDiscoverySnapshotSchema, calendarDiscoveryEntrySchema } from '../../src/contracts/calendar-discovery.js';
import { calendarAvailabilityResultSchema } from '../../src/contracts/calendar-availability.js';
import { calendarProposalSchema, proposalMatchesReply, calendarProposalReplySchema } from '../../src/contracts/calendar-authority.js';
import { calendarResultV2Schema, calendarInputSchemas, CALENDAR_TOOLS } from '../../src/contracts/calendar-tools.js';
import { repairDiagnosticsSchema } from '../../src/contracts/calendar-model.js';
import { calendarTurnStateV2Schema } from '../../src/contracts/calendar-wire.js';
import { snapshot, entry, proposal, availability, at } from './calendar-multi-fixtures.js';

it('rejects unknown fields and new-version laundering at every public authority boundary', () => {
  expect(Object.values(COLLECTIONS)).toEqual(['sessions', 'messages', 'agent-memory', 'metadata',
    'checkpoints', 'checkpoint_writes', 'config', 'integration_connections', 'users']);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, extra: true }).success).toBe(false);
  expect(calendarDiscoveryEntrySchema.safeParse({ ...entry, accessToken: 'secret' }).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...availability, schemaVersion: 1 }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, approvedByModel: true }).success).toBe(false);
  for (const definition of CALENDAR_TOOLS) {
    for (const path of Object.keys(definition.inputSchema.properties)) {
      expect(repairDiagnosticsSchema.safeParse([{ path, code: 'missing', expected: 'bounded-value' }]).success).toBe(true);
    }
  }
  const reply = calendarProposalReplySchema.parse({ userId: 'u', sessionId: 's', connectionId: 'c',
    connectionRevision: 1, googleSubjectId: 'sub', proposalId: 'p', expectedProposalRevision: 1,
    acceptedMessageId: 'followup', acceptedTurnId: 'next', canonicalActionHash: proposal.canonicalActionHash,
    conditionFingerprint: proposal.conditionFingerprint, choiceCalendarId: null, receivedAt: at, decision: 'accept' });
  // A selection proposal must not be consumed as a generic yes without choosing a candidate.
  const selection = calendarProposalSchema.parse({ ...proposal, purpose: 'selection', target: null,
    canonicalActionHash: null, action: { ...proposal.action, calendarId: undefined },
    candidates: [{ target: proposal.target, canonicalActionHash: proposal.canonicalActionHash }],
    conditionFingerprint: null, availabilityRevision: null, disclosedLimitations: [] });
  expect(proposalMatchesReply(selection, { ...reply, conditionFingerprint: null,
    choiceCalendarId: proposal.target.calendarId })).toBe(false);
  // Free windows must partition the whole checked range; a gap is not a complete free result.
  expect(calendarAvailabilityResultSchema.safeParse({ ...availability, free: [] }).success).toBe(false);
  const parsed = calendarResultV2Schema.safeParse({ ...availability, calendars: [], free: [],
    coverage: 'incomplete', conflict: 'unknown', limitations: ['calendar-limit'], truncated: true });
  expect(parsed.success).toBe(true);
  expect(calendarInputSchemas.calendar_check_availability.safeParse({ timeMin: at, timeMax: at,
    timeZone: 'UTC', calendarIds: ['same', 'same'] }).success).toBe(false);
  expect(calendarTurnStateV2Schema.safeParse({ schemaVersion: 2, operationId: 'o', state: 'failed',
    narration: 'failed', retryAction: 'none', receipt: null }).success).toBe(true);
});

it('honors exact count time and UTF-8 limits without raising ceilings', () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ ...entry, calendarId: `c${i}`, primary: i === 0 }));
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries }).success).toBe(true);
  expect(calendarDiscoverySnapshotSchema.safeParse({ ...snapshot, entries: [...entries,
    { ...entry, primary: false, calendarId: 'overflow' }] }).success).toBe(false);
  const huge = entries.map((e, i) => ({ ...e, calendarId: `${i}-${'界'.repeat(1019)}`,
    label: '界'.repeat(200), timeZone: '界'.repeat(100) }));
  const oversized = { ...snapshot, entries: huge };
  expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBeGreaterThan(262144);
  expect(calendarDiscoverySnapshotSchema.safeParse(oversized).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...availability,
    timeMax: '2026-11-22T10:00:00.001Z', free: [{ start: at, end: '2026-11-22T10:00:00.001Z' }] }).success).toBe(false);
  expect(calendarAvailabilityResultSchema.safeParse({ ...availability, timeMax: at }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, expiresAt: proposal.createdAt }).success).toBe(false);
  expect(calendarProposalSchema.safeParse({ ...proposal, expiresAt: '2026-10-22T10:10:00.001Z' }).success).toBe(false);
  expect(repairDiagnosticsSchema.safeParse(Array(11).fill({ path: 'calendarIds', code: 'missing', expected: 'object' })).success).toBe(false);
});
