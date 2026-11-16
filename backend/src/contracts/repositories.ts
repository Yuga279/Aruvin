/**
 * ============================================================================
 * FILE: repositories.ts
 * LOCATION: backend/src/contracts/repositories.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define persistence and execution-ownership ports for downstream adapters.
 *
 * ROLE IN PROJECT:
 *    Keeps repositories independently implementable and avoids assuming
 *    cross-collection transactions or any unverified database capabilities.
 *
 * KEY COMPONENTS:
 *    - Archive repositories: Manage session, message, memory, and metadata data.
 *    - Ownership/checkpoint ports: Define leases and standard saver setup.
 * ============================================================================
 */

import type { AgentMemoryManifest } from './agent-memory.js';
import type { AccountingRecord } from './metadata.js';
import type { AttemptRecord } from './attempt.js';
import type { ListMessagesResponse, SessionSummary } from './api.js';
import type { MessageCompletionStatus, MessageRecord } from './message.js';
import type { SessionRecord } from './session.js';
import type { AccountingQuery, AccountingTotals } from './accounting-reporting.js';
import type { VoiceAccountingRecord } from './voice-accounting.js';
import type { CasConfirmation, ConfirmedRecord } from '../persistence/confirmed-record.js';

export type PageQuery = {
  cursor: string | null;
  limit: number;
};

export interface SessionRepository {
  get(userId: string, sessionId: string): Promise<SessionRecord | null>;
  list(
    userId: string,
    page: PageQuery,
  ): Promise<{ items: SessionSummary[]; nextCursor: string | null }>;
  createIfAbsent(record: SessionRecord): Promise<SessionRecord>;
  touchActivity(userId: string, sessionId: string, at: string): Promise<void>;
  update(userId: string, sessionId: string, changes: { title?: string; pinned?: boolean }): Promise<void>;
  delete(userId: string, sessionId: string): Promise<void>;
}

export interface MessageRepository {
  listPublished?(userId: string, sessionId: string, page: PageQuery, maxSequence: number): Promise<ListMessagesResponse>;
  append(record: MessageRecord): Promise<void>;
  appendConfirmed?(record: MessageRecord): Promise<ConfirmedRecord<MessageRecord>>;
  list(
    userId: string,
    sessionId: string,
    page: PageQuery,
  ): Promise<ListMessagesResponse>;
  get(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<MessageRecord | null>;
  getConfirmed?(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<ConfirmedRecord<MessageRecord> | null>;
  updateCompletion(
    userId: string,
    sessionId: string,
    messageId: string,
    completionStatus: MessageCompletionStatus,
    truncated: boolean,
  ): Promise<void>;
  updateCompletionConfirmed?(
    expected: ConfirmedRecord<MessageRecord>,
    status: MessageCompletionStatus,
    truncated: boolean,
  ): Promise<ConfirmedRecord<MessageRecord>>;
}

export interface AgentMemoryRepository {
  get(userId: string, sessionId: string): Promise<AgentMemoryManifest | null>;
  getConfirmed?(userId: string, sessionId: string): Promise<ConfirmedRecord<AgentMemoryManifest> | null>;
  put(manifest: AgentMemoryManifest): Promise<void>;
  putConfirmed?(
    manifest: AgentMemoryManifest,
    expected?: ConfirmedRecord<AgentMemoryManifest>,
  ): Promise<ConfirmedRecord<AgentMemoryManifest>>;
}

export interface MetadataRepository {
  putAttempt(record: AttemptRecord): Promise<void>;
  putAttemptConfirmed?(record: AttemptRecord): Promise<ConfirmedRecord<AttemptRecord>>;
  getAttempt(
    userId: string,
    sessionId: string,
    attemptId: string,
  ): Promise<AttemptRecord | null>;
  getAttemptConfirmed?(
    userId: string,
    sessionId: string,
    attemptId: string,
  ): Promise<ConfirmedRecord<AttemptRecord> | null>;
  getAttemptByIdempotency(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
  ): Promise<AttemptRecord | null>;
  compareAttemptConfirmed?(
    expected: ConfirmedRecord<AttemptRecord>,
    next: AttemptRecord,
  ): Promise<CasConfirmation<AttemptRecord>>;
  getAccountingConfirmed?(
    userId: string,
    sessionId: string,
    attemptId: string,
  ): Promise<ConfirmedRecord<AccountingRecord> | null>;
  putAccounting(record: AccountingRecord): Promise<void>;
  putAccountingConfirmed?(
    record: AccountingRecord,
    expected?: ConfirmedRecord<AccountingRecord>,
  ): Promise<ConfirmedRecord<AccountingRecord>>;
}

/** Internal persistence port only; no HTTP authorization surface is implied. */
export interface AccountingReportingRepository {
  accountingTotals(query: AccountingQuery): Promise<{ items: AccountingTotals[]; nextCursor: string | null }>;
  listAccounting(query: AccountingQuery & { userId: string }): Promise<{
    items: (AccountingRecord | VoiceAccountingRecord)[]; nextCursor: string | null;
  }>;
}

export type ExecutionLease = {
  ownerId: string;
  sessionId: string;
  userId: string;
  leaseExpiresAt: string;
  generation: number;
};

export type OwnedPhaseName =
  | 'boundary-bootstrap'
  | 'acceptance-stage'
  | 'acceptance-publish'
  | 'generation-start'
  | 'publication-stage'
  | 'publication-commit'
  | 'model-observation';

export type OwnedPhaseOptions = {
  name: OwnedPhaseName;
  deadlineAt: number;
  maxOperations: number;
};

export type AcquireExecutionResult =
  | { ok: true; lease: ExecutionLease; session?: SessionRecord }
  | { ok: false; code: 'CONFLICT_ACTIVE_TURN' };

export interface ExecutionOwnership {
  acquire(input: {
    userId: string;
    sessionId: string;
    ownerId: string;
    leaseMs: number;
    expectedGeneration?: number;
  }): Promise<AcquireExecutionResult>;
  fence(lease: ExecutionLease): Promise<boolean>;
  runPhase?<T>(
    lease: ExecutionLease,
    options: OwnedPhaseOptions,
    action: () => Promise<T>,
  ): Promise<T>;
  detachAccepted?(
    lease: ExecutionLease,
    attemptId: string,
  ): Promise<{ releasedGeneration: number }>;
  attachAccepted?(input: {
    userId: string;
    sessionId: string;
    attemptId: string;
    expectedGeneration?: number;
    leaseMs: number;
  }): Promise<{ lease: ExecutionLease; session: SessionRecord }>;
  finishAttempt?(
    lease: ExecutionLease,
    terminalAttemptReceipt: ConfirmedRecord<AttemptRecord>,
    activityAt: string,
  ): Promise<void>;
  release(lease: ExecutionLease): Promise<void>;
}

export interface CheckpointerSetup {
  setup(): Promise<void>;
}

export interface CheckpointStoreFactory {
  create(): Promise<CheckpointerSetup>;
}
