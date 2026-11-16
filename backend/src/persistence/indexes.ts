/**
 * ============================================================================
 * FILE: indexes.ts
 * LOCATION: backend/src/persistence/indexes.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define and create non-unique application indexes for the four app collections.
 *
 * ROLE IN PROJECT:
 *    Uses ordinary compound indexes for the admitted native profile, leaving
 *    stock saver indexes unchanged; selected-service certification is separate.
 *
 * KEY COMPONENTS:
 *    - APP_INDEXES: Operational and bounded reporting non-unique compound indexes.
 *    - setupIndexes: Idempotent index creation used by the persistence bundle.
 * ============================================================================
 */

import type { CreateIndexesOptions, Db, IndexSpecification } from 'mongodb';
import { AppError } from '../platform/errors/app-error.js';

type AppIndex = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions;
};

export const APP_INDEXES: AppIndex[] = [
  {
    collection: 'sessions',
    keys: { userId: 1, lastActivityAt: -1, sessionId: -1 },
    options: { name: 'user_activity_session' },
  },
  {
    collection: 'sessions',
    keys: { userId: 1, lifecycle: 1, pinned: 1, lastActivityAt: -1, sessionId: -1 },
    options: { name: 'user_lifecycle_pin_activity_session' },
  },
  {
    collection: 'messages',
    keys: { userId: 1, sessionId: 1, sequence: -1, messageId: -1 },
    options: { name: 'scope_sequence_message' },
  },
  {
    collection: 'messages',
    keys: { userId: 1, sessionId: 1, messageId: 1 },
    options: { name: 'scope_message' },
  },
  {
    collection: 'agent-memory',
    keys: { userId: 1, sessionId: 1 },
    options: { name: 'scope_manifest' },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, kind: 1, attemptId: 1 },
    options: { name: 'scope_kind_attempt' },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, kind: 1, idempotencyKey: 1 },
    options: { name: 'scope_kind_request' },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, kind: 1, sequence: -1, attemptId: -1 },
    options: { name: 'scope_kind_sequence' },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, kind: 1, generationId: 1 },
    options: { name: 'user_kind_generation' },
  },
  {
    collection: 'metadata',
    keys: { kind: 1, userId: 1, startedAt: 1, _id: 1 },
    options: { name: 'kind_user_accounting_range' },
  },
  {
    collection: 'metadata',
    keys: { kind: 1, startedAt: 1, userId: 1 },
    options: { name: 'kind_accounting_range_user' },
  },
  {
    collection: 'users',
    keys: { workosUserId: 1 },
    options: { name: 'users_workos_subject', unique: true },
  },
  {
    collection: 'users',
    keys: { emailNormalized: 1 },
    options: { name: 'users_email', unique: true },
  },
  {
    collection: 'users',
    keys: { createdAt: -1, userId: -1 },
    options: { name: 'users_created_identity' },
  },
];

const liveOrTombstone = {
  kind: { $in: ['calendar-operation', 'calendar-operation-tombstone'] },
};

export const CALENDAR_INDEXES: AppIndex[] = [
  {
    collection: 'integration_connections',
    keys: { userId: 1, provider: 1 },
    options: { name: 'calendar_owner', unique: true },
  },
  {
    collection: 'integration_connections',
    keys: { userId: 1, connectionId: 1 },
    options: { name: 'calendar_connection_identity', unique: true },
  },
  {
    collection: 'metadata',
    keys: { stateHash: 1 },
    options: {
      name: 'calendar_oauth_hash',
      unique: true,
      partialFilterExpression: { kind: 'calendar-oauth-state' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, turnId: 1 },
    options: {
      name: 'calendar_operation_turn',
      unique: true,
      partialFilterExpression: liveOrTombstone,
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, operationId: 1 },
    options: {
      name: 'calendar_operation_identity',
      unique: true,
      partialFilterExpression: liveOrTombstone,
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, operationId: 1, sequence: 1 },
    options: {
      name: 'calendar_operation_event_sequence',
      unique: true,
      partialFilterExpression: { kind: 'calendar-operation-event' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, eventId: 1 },
    options: {
      name: 'calendar_operation_event_identity',
      unique: true,
      partialFilterExpression: { kind: 'calendar-operation-event' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, turnId: 1 },
    options: {
      name: 'calendar_budget_turn',
      unique: true,
      partialFilterExpression: { kind: 'calendar-turn-budget' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, dispatchId: 1 },
    options: {
      name: 'calendar_dispatch_identity',
      unique: true,
      partialFilterExpression: { kind: 'calendar-model-dispatch' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, turnId: 1, dispatchIndex: 1 },
    options: {
      name: 'calendar_dispatch_order',
      unique: true,
      partialFilterExpression: { kind: 'calendar-model-dispatch' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, generationId: 1 },
    options: {
      name: 'calendar_dispatch_generation',
      unique: true,
      partialFilterExpression: {
        kind: 'calendar-model-dispatch',
        generationId: { $type: 'string' },
      },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, turnId: 1, attemptId: 1 },
    options: {
      name: 'calendar_aggregate_attempt',
      unique: true,
      partialFilterExpression: { kind: 'calendar-model-aggregate' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, decisionId: 1, kind: 1 },
    options: {
      name: 'calendar_decision_identity',
      unique: true,
      partialFilterExpression: {
        kind: { $in: ['calendar-model-decision', 'calendar-rejected-decision'] },
      },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, toolCallId: 1 },
    options: {
      name: 'calendar_result_identity',
      unique: true,
      partialFilterExpression: { kind: 'calendar-tool-result' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, sourceId: 1 },
    options: {
      name: 'calendar_source_identity',
      unique: true,
      partialFilterExpression: { kind: 'calendar-source' },
    },
  },
  {
    collection: 'messages',
    keys: { userId: 1, sessionId: 1, 'sourceProvenance.sourceId': 1 },
    options: { name: 'calendar_message_source' },
  },
  {
    collection: 'metadata',
    keys: { kind: 1, '_calendarAudit.expiresAt': 1, _id: 1 },
    options: { name: 'calendar_audit_expiry' },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1 },
    options: {
      name: 'calendar_pending_proposal_session',
      unique: true,
      partialFilterExpression: { kind: 'calendar-proposal', state: 'pending' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, proposalId: 1 },
    options: {
      name: 'calendar_proposal_identity',
      unique: true,
      partialFilterExpression: { kind: { $in: ['calendar-proposal', 'calendar-proposal-tombstone'] } },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, intentId: 1 },
    options: {
      name: 'calendar_operation_intent',
      unique: true,
      partialFilterExpression: { kind: 'calendar-operation', schemaVersion: 2 },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, intentId: 1 },
    options: {
      name: 'calendar_intent_reservation',
      unique: true,
      partialFilterExpression: { kind: 'calendar-intent-reservation' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, intentId: 1 },
    options: {
      name: 'calendar_consumption_intent',
      partialFilterExpression: { kind: 'calendar-proposal-consumption' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, sessionId: 1, proposalId: 1 },
    options: {
      name: 'calendar_consumption_proposal',
      unique: true,
      partialFilterExpression: { kind: 'calendar-proposal-consumption' },
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, kind: 1, expiresAt: 1, _id: 1 },
    options: {
      name: 'calendar_content_expiry',
    },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, kind: 1, 'source.connectionId': 1, 'source.connectionRevision': 1, _id: 1 },
    options: { name: 'calendar_invalidation_source',
      partialFilterExpression: { kind: 'calendar-source' } },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, kind: 1, connectionId: 1, connectionRevision: 1, _id: 1 },
    options: { name: 'calendar_invalidation_decision',
      partialFilterExpression: { kind: 'calendar-model-decision' } },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, kind: 1, 'resultRef.source.connectionId': 1,
      'resultRef.source.connectionRevision': 1, _id: 1 },
    options: { name: 'calendar_invalidation_result',
      partialFilterExpression: { kind: 'calendar-tool-result' } },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, kind: 1, connectionId: 1, connectionRevision: 1, _id: 1 },
    options: { name: 'calendar_invalidation_operation',
      partialFilterExpression: { kind: 'calendar-operation' } },
  },
  {
    collection: 'metadata',
    keys: { userId: 1, kind: 1, connectionId: 1, connectionRevision: 1, _id: 1 },
    options: { name: 'calendar_invalidation_proposal',
      partialFilterExpression: { kind: 'calendar-proposal' } },
  },
  {
    collection: 'messages',
    keys: { userId: 1, 'sourceProvenance.connectionId': 1,
      'sourceProvenance.connectionRevision': 1, _id: 1 },
    options: { name: 'calendar_invalidation_message' },
  },
];

export async function setupIndexes(db: Db): Promise<void> {
  try {
    for (const index of [...APP_INDEXES, ...CALENDAR_INDEXES]) {
      await db.collection(index.collection).createIndex(index.keys, index.options);
    }
  } catch {
    throw new AppError('NOT_READY', 'Chat storage setup failed.');
  }
}
