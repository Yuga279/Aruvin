/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/persistence/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Supply typed bounded persistence record factories for P2 tests.
 *
 * ROLE IN PROJECT:
 *    Keeps native and deterministic persistence tests aligned with P1 schemas
 *    without copying ad-hoc record literals through each suite.
 *
 * KEY COMPONENTS:
 *    - session/message/attempt/manifest/accounting: Version-1 fixture builders.
 * ============================================================================
 */

import type {
  AccountingRecord,
  AgentMemoryManifest,
  AttemptRecord,
  MessageRecord,
  SessionRecord,
} from '../../src/contracts/index.js';
import { graphThreadId } from '../../src/persistence/records.js';

export const at = '2026-10-06T00:00:00.000Z';

export function session(userId = 'u1', sessionId = 's1'): SessionRecord {
  return {
    schemaVersion: 1,
    userId,
    sessionId,
    title: 'Hello',
    createdAt: at,
    updatedAt: at,
    lastActivityAt: at,
    lifecycle: 'active',
    graphThreadId: graphThreadId(userId, sessionId),
    latestTurnId: null,
    execution: {
      ownerId: null,
      leaseExpiresAt: null,
      activeAttemptId: null,
      generation: 0,
    },
  };
}

export function message(
  sequence = 0,
  userId = 'u1',
  sessionId = 's1',
): MessageRecord {
  return {
    schemaVersion: 1,
    userId,
    sessionId,
    turnId: 't1',
    messageId: `m${sequence}`,
    eventId: `e${sequence}`,
    sequence,
    role: sequence === 0 ? 'user' : 'assistant',
    content: 'Hello',
    createdAt: at,
    completionStatus: sequence === 0 ? 'accepted' : 'completed',
    attemptId: sequence === 0 ? null : 'a1',
    truncated: false,
  };
}

export function attempt(): AttemptRecord {
  return {
    schemaVersion: 1,
    kind: 'attempt',
    userId: 'u1',
    sessionId: 's1',
    turnId: 't1',
    attemptId: 'a1',
    idempotencyKey: 'request-0001',
    payloadHash: 'a'.repeat(64),
    status: 'accepted',
    sequence: 1,
    createdAt: at,
    updatedAt: at,
    instructionVersion: 'phase1.v1',
    knowledgeContentHash: 'abc',
    graphSchemaVersion: 'phase1.v1',
    contextVersion: 0,
    modelId: 'fixture/model',
    openRouterUser: 'u1',
    generationId: null,
    truncated: false,
    errorCode: null,
    causal: { userMessageId: 'm0', previousAttemptId: null },
  };
}

export function manifest(): AgentMemoryManifest {
  return {
    schemaVersion: 1,
    userId: 'u1',
    sessionId: 's1',
    contextVersion: 1,
    sourceRanges: [
      {
        fromSequence: 0,
        toSequence: 0,
        fromEventId: 'e0',
        toEventId: 'e0',
      },
    ],
    messageRefs: [{ messageId: 'm0', eventId: 'e0', sequence: 0 }],
    activeSummaryRef: null,
    instructionVersion: 'phase1.v1',
    knowledgeContentHash: 'abc',
    graphSchemaVersion: 'phase1.v1',
  };
}

export function accounting(): AccountingRecord {
  return {
    schemaVersion: 1,
    kind: 'accounting',
    userId: 'u1',
    sessionId: 's1',
    turnId: 't1',
    attemptId: 'a1',
    generationId: null,
    requestedModel: 'fixture/model',
    reportedModel: null,
    reportedProvider: null,
    promptTokens: null,
    completionTokens: null,
    cost: null,
    accountingStatus: 'unknown',
    outcome: 'accepted',
    startedAt: at,
    endedAt: null,
  };
}
