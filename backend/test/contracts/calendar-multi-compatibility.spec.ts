/**
 * ============================================================================
 * FILE: calendar-multi-compatibility.spec.ts
 * LOCATION: backend/test/contracts/calendar-multi-compatibility.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Google Calendar Phase 2 backward compatibility and legacy read-only decoders.
 *
 * ROLE IN PROJECT:
 *    Tests that legacy v1 records, receipts, operations, cursors, checkpoints, and
 *    dispositions decode faithfully without granting new authority or replaying uncertain effects.
 *
 * KEY COMPONENTS:
 *    - compatibleCalendarConnectionSchema / compatibleCalendarOperationSchema
 *    - compatibleCalendarReceiptSchema / compatibleCalendarSourceSchema
 *    - legacyOperationDisposition / calendarLegacyDispositionSchema
 *    - calendarCursorV2PayloadSchema / compatibleCalendarCheckpointRefsSchema
 *    - resumableDecisionV2Schema / rejectedDecisionV2Schema / modelDispatchV2Schema
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { compatibleCalendarConnectionSchema, compatibleCalendarOperationSchema,
  compatibleCalendarReceiptSchema, calendarCursorV2PayloadSchema, compatibleCalendarCursorPayloadSchema,
  compatibleCalendarCheckpointRefsSchema, legacyOperationDisposition, calendarLegacyDispositionSchema,
} from '../../src/contracts/calendar-compatibility.js';
import { CALENDAR_SCOPES_V1 } from '../../src/contracts/calendar-policy.js';
import { resumableDecisionV2Schema, rejectedDecisionV2Schema } from '../../src/contracts/calendar-model.js';
import { modelDispatchV2Schema, unavailableMoney } from '../../src/contracts/calendar-accounting.js';
import { operationV1, receiptV1, at, until, hash, sourceV2 } from './calendar-multi-fixtures.js';

it('decodes v1 faithfully while denying new authority and preserving uncertain effects', () => {
  const credentials = { access: null, refresh: { version: 1, iv: 'i', tag: 't', ciphertext: 'cipher' } };
  const old = { schemaVersion: 1, userId: 'u', provider: 'google-calendar', connectionId: 'c',
    revision: 1, connectionRevision: 1, credentialVersion: 1, googleSubjectId: 'sub', accountEmail: null,
    calendarId: operationV1.calendarId, targetRevision: 1, enabled: true, status: 'connected',
    credentials, tokenExpiresAt: null, grantedScopes: [...CALENDAR_SCOPES_V1], updatedAt: at };
  expect(compatibleCalendarConnectionSchema.parse(old)).toEqual(old);
  expect(compatibleCalendarOperationSchema.parse(operationV1)).toEqual({ ...operationV1, actionSources: [] });
  expect(compatibleCalendarReceiptSchema.parse(receiptV1)).toEqual(receiptV1);
  const complete = { ...operationV1, state: 'succeeded', receipt: receiptV1 };
  expect(compatibleCalendarOperationSchema.parse(complete).receipt).toEqual(receiptV1);
  expect(legacyOperationDisposition(compatibleCalendarOperationSchema.parse(operationV1), at))
    .toMatchObject({ state: 'failed', externalOutcome: 'not-dispatched', reconcileOriginal: false });
  const unknown = compatibleCalendarOperationSchema.parse({ ...operationV1, state: 'unknown' });
  const disposition = legacyOperationDisposition(unknown, at);
  expect(disposition).toMatchObject({ state: 'cancelled', externalOutcome: 'unknown', reconcileOriginal: true });
  expect(calendarLegacyDispositionSchema.safeParse({ ...disposition, reconcileOriginal: false }).success).toBe(false);
  expect(legacyOperationDisposition(compatibleCalendarOperationSchema.parse(complete), at)).toBeNull();
  const v1cursor = { v: 1, b: hash, q: hash, t: 'opaque-provider-token' };
  expect(compatibleCalendarCursorPayloadSchema.parse(v1cursor)).toEqual(v1cursor);
  expect(calendarCursorV2PayloadSchema.safeParse(v1cursor).success).toBe(false);
  const v2cursor = { ...v1cursor, v: 2, kind: 'events', discoveryRevision: 1, expiresAt: at };
  expect(calendarCursorV2PayloadSchema.safeParse(v2cursor).success).toBe(true);
  expect(calendarCursorV2PayloadSchema.safeParse({ ...v2cursor, defaultSettingRevision: 2 }).success).toBe(false);
  const checkpoint = { version: 1, userId: 'u', sessionId: 's', turnId: 't',
    decisionIds: ['d'], toolCallIds: ['call'], operationId: 'op' };
  expect(compatibleCalendarCheckpointRefsSchema.parse(checkpoint)).toEqual(checkpoint);
  expect(resumableDecisionV2Schema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  expect(rejectedDecisionV2Schema.safeParse({ schemaVersion: 1 }).success).toBe(false);
  expect(modelDispatchV2Schema.safeParse({ schemaVersion: 1 }).success).toBe(false);
});

it('admits explicit v2 model evidence without replenishing v1 counters', () => {
  const rejected = { schemaVersion: 2, schemaRevision: 'google-calendar.v2', kind: 'calendar-rejected-decision',
    userId: 'u', sessionId: 's', turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch',
    dispatchIndex: 1, repairsUsed: 0, rawArgumentsSha256: hash,
    diagnostics: [{ path: 'calendarId', code: 'wrong-type', expected: 'string' }], createdAt: at };
  expect(rejectedDecisionV2Schema.safeParse(rejected).success).toBe(true);
  const decision = { schemaVersion: 2, kind: 'calendar-model-decision', userId: 'u', sessionId: 's',
    turnId: 't', attemptId: 'a', decisionId: 'd', dispatchId: 'dispatch', configRevision: 1,
    connectionId: 'c', connectionRevision: 1, schemaRevision: 'google-calendar.v2', rejectedDecisionId: null,
    decision: null, sources: [], operationId: null, intentId: null, proposalId: null, createdAt: at };
  expect(resumableDecisionV2Schema.safeParse(decision).success).toBe(true);
  const dispatch = { schemaVersion: 2, kind: 'calendar-model-dispatch', userId: 'u', sessionId: 's',
    turnId: 't', attemptId: 'a', dispatchId: 'dispatch', decisionId: 'd', dispatchIndex: 1,
    reason: 'initial', repairedDecisionId: null, requestedModel: 'fixture', reportedModel: null,
    reportedProvider: null, openRouterUser: 'u', configRevision: 1, connectionId: 'c', connectionRevision: 1,
    schemaRevision: 'google-calendar.v2', generationId: null, providerRequestId: null, status: 'reserved',
    startedAt: at, endedAt: null, firstOutputAt: null, promptTokens: null, completionTokens: null,
    cachedPromptTokens: null, cacheWriteTokens: null, reasoningOutputTokens: null,
    money: unavailableMoney(true), reservationUsd: '0.1', reservationStatus: 'held', failure: null,
    pricing: { version: 'p', source: 'fixture', observedAt: at, modelId: 'fixture', providerRoute: 'fixture',
      promptUsdPerToken: '0', completionUsdPerToken: '0', requestUsd: '0' } };
  expect(modelDispatchV2Schema.safeParse(dispatch).success).toBe(true);
  expect(modelDispatchV2Schema.safeParse({ ...dispatch, reasoning: 'forbidden' }).success).toBe(false);
  expect(modelDispatchV2Schema.safeParse({ ...dispatch, dispatchIndex: 9 }).success).toBe(false);
  expect(sourceV2.expiresAt).toBe(until);
});
