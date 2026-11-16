/**
 * ============================================================================
 * FILE: calendar-multi-fixtures.ts
 * LOCATION: backend/test/persistence/calendar-multi-fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Parsed inert fixture factories for Google Calendar Phase 2 persistence tests.
 *
 * ROLE IN PROJECT:
 *    Provides pre-validated v2 connection, proposal, reply, and operation records
 *    used across persistence unit and native tests without network or DB dependency.
 *
 * KEY COMPONENTS:
 *    - connectionV2: Validated CalendarConnectionRecordV2 fixture factory.
 *    - pendingProposal: Validated CalendarProposalRecord fixture factory.
 *    - acceptedReply: Validated CalendarProposalReply fixture factory.
 *    - directOperation: Validated CalendarOperationV2 fixture factory.
 * ============================================================================
 */

import { calendarConnectionV2Schema } from '../../src/contracts/calendar-discovery.js';
import { calendarProposalSchema, calendarProposalReplySchema } from '../../src/contracts/calendar-authority.js';
import { operationRecordV2Schema } from '../../src/contracts/calendar-operations.js';
import { CALENDAR_SCOPES } from '../../src/contracts/calendar-policy.js';
import { account, at, until, snapshot, proposal, operationV2, hash }
  from '../contracts/calendar-multi-fixtures.js';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { MongoCalendarConnections } from '../../src/persistence/calendar-connections.js';
import { calendarMemory } from './calendar-multi-memory.js';
import { secretEnvelope } from './calendar-fixtures.js';

export const connectionV2 = () => calendarConnectionV2Schema.parse({ ...account,
  schemaVersion: 2, provider: 'google-calendar', revision: 1, credentialVersion: 1,
  accountEmail: null, enabled: true, status: 'connected',
  credentials: { access: secretEnvelope, refresh: secretEnvelope }, tokenExpiresAt: until,
  grantedScopes: [...CALENDAR_SCOPES], updatedAt: at,
  defaultSetting: { defaultCalendarId: null, defaultSettingRevision: 1 },
  discovery: { ...snapshot, retentionExpiresAt: '2026-10-22T10:10:00.000Z' } });
export const pendingProposal = () => calendarProposalSchema.parse(proposal);
export const acceptedReply = () => calendarProposalReplySchema.parse({ ...account, sessionId: 's',
  proposalId: 'p', expectedProposalRevision: 1, acceptedMessageId: 'followup-message',
  acceptedTurnId: 'followup-turn', canonicalActionHash: hash, conditionFingerprint: hash,
  choiceCalendarId: null, receivedAt: '2026-10-22T10:01:00.000Z', decision: 'accept' });
export const directOperation = () => operationRecordV2Schema.parse(operationV2);

export async function connectedCalendarMemory() {
  const f = calendarMemory();
  const connections = new MongoCalendarConnections(f.store, DEFAULT_BUDGETS);
  const saved = await connections.v2.create(connectionV2());
  if (saved.outcome !== 'confirmed') throw new Error('fixture connection did not persist');
  return f;
}
