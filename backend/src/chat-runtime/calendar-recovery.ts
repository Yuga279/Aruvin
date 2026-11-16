import type { PersistenceBundle } from '../persistence/persistence.js';
import type { ExecutionLease } from '../contracts/repositories.js';
import type { CalendarConnectionBinding } from '../contracts/calendar-connections.js';
import type { CalendarExecutionPort, CalendarExecutionPortV2, CalendarOperation, CalendarOperationV2 } from '../contracts/calendar-operations.js';
import type { CalendarAccountBinding } from '../contracts/calendar-discovery.js';
import type { CalendarCapabilityGate } from '../contracts/calendar-authority.js';
import { AppError } from '../platform/errors/app-error.js';
import { transitionOperation, transitionOperationV2, type CalendarOperationWriterOptions } from './calendar-operation.js';
import type { CalendarSeal } from './calendar-ports.js';
import { attemptsFor } from './history.js';
import type { Work } from './work.js';

export type CalendarContinuation =
  | { kind: 'publish'; seal: CalendarSeal | null }
  | { kind: 'reuse-decision'; decisionId: string }
  | { kind: 'reuse-result'; decisionId: string; toolCallId: string }
  | { kind: 'repair-consumption'; intentId: string }
  | { kind: 'dispatch-planned'; operationId: string }
  | { kind: 'reconcile-operation'; operationId: string }
  | { kind: 'fresh-dispatch'; reason: 'initial' | 'continuation' | 'schema-repair' }
  | { kind: 'interrupt'; code: 'EVIDENCE_MISSING' | 'EVIDENCE_EXPIRED' | 'INFERENCE_OUTCOME_UNKNOWN' |
      'CONNECTION_CHANGED' | 'TURN_DEADLINE_EXCEEDED' };

/**
 * The reconciliation binding is the connection and target revision the write was
 * dispatched on, never the live one. A missing, revoked, replaced or
 * unconfigured Calendar therefore fails the readback closed inside the gate and
 * leaves the operation unknown, instead of aborting the ordinary text recovery
 * that asked for the reconciliation.
 */
function bindingOf(operation: CalendarOperation): CalendarConnectionBinding {
  return {
    userId: operation.userId, connectionId: operation.connectionId,
    connectionRevision: operation.connectionRevision, googleSubjectId: operation.googleSubjectId,
    calendarId: operation.calendarId, targetRevision: operation.targetRevision,
  };
}

/**
 * The v2 readback is pinned to the ORIGINAL operation: the original event id,
 * the original calendar, the original connection revision and the original
 * target revision. Current names are not durable receipt evidence.
 */
function bindingOfV2(operation: CalendarOperationV2): CalendarConnectionBinding {
  return {
    userId: operation.userId, connectionId: operation.connectionId,
    connectionRevision: operation.connectionRevision, googleSubjectId: operation.googleSubjectId,
    calendarId: operation.calendarId, targetRevision: operation.targetRevision,
  };
}

export async function reconcileCalendarOperation(input: {
  persistence: PersistenceBundle;
  lease: ExecutionLease;
  job: Work;
  userId: string;
  sessionId: string;
  execution: CalendarExecutionPort;
  trustedTimeZone: string;
  now: () => string;
}): Promise<void> {
  const session = await input.persistence.sessions.get(input.userId, input.sessionId);
  const turnId = session?.latestTurnId;
  if (!turnId) return;
  const operation = await input.persistence.calendarOperations.getByTurn(input.userId, input.sessionId, turnId);
  if (!operation) return;
  if (operation.state !== 'dispatching' && operation.state !== 'unknown') return;
  const attempts = await attemptsFor(input.persistence, input.userId, input.sessionId);
  const attempt = attempts.filter(item => item.turnId === turnId).at(-1);
  if (!attempt) return;
  const budget = await input.persistence.calendarAccounting.getBudget(input.userId, input.sessionId, turnId);
  const deadlineAt = budget?.deadlineAt ?? operation.auditExpiresAt;
  const binding = bindingOf(operation);
  // A readback that cannot be completed is an unknown external outcome. It is
  // never a success and never a reason to fail the surrounding text recovery.
  const outcome = await input.execution.readback({
    binding: {
      ...binding, sessionId: input.sessionId, turnId, attemptId: attempt.attemptId,
      decisionId: attempt.attemptId, toolCallId: operation.operationId, schemaRevision: 'google-calendar.v1',
      operation, trustedNow: input.now(), trustedTimeZone: input.trustedTimeZone, deadlineAt,
    },
    operation, signal: input.job.signal,
    consumeRequest: async () => undefined,
    consumeRefreshRequest: async () => undefined,
  }).catch(() => ({ outcome: 'unknown' as const }));
  if (outcome.outcome === 'matched') {
    const options: CalendarOperationWriterOptions = {
      operations: input.persistence.calendarOperations, execution: input.execution,
      write: action => input.job.wait(input.persistence.owner.run(input.lease, action), 15000),
      ledger: null as never, identity: {
        userId: input.userId, sessionId: input.sessionId, turnId, attemptId: attempt.attemptId,
      }, binding, clock: Date.now, job: input.job,
      fence: () => input.persistence.owner.fence(input.lease),
      requireCurrent: async () => undefined,
      permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
      trustedTimeZone: input.trustedTimeZone,
    };
    await transitionOperation(options, operation, { state: 'succeeded', receipt: outcome.receipt });
    return;
  }
  if (operation.state === 'dispatching') {
    const options: CalendarOperationWriterOptions = {
      operations: input.persistence.calendarOperations, execution: input.execution,
      write: action => input.job.wait(input.persistence.owner.run(input.lease, action), 15000),
      ledger: null as never, identity: {
        userId: input.userId, sessionId: input.sessionId, turnId, attemptId: attempt.attemptId,
      }, binding, clock: Date.now, job: input.job,
      fence: () => input.persistence.owner.fence(input.lease),
      requireCurrent: async () => undefined,
      permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
      trustedTimeZone: input.trustedTimeZone,
    };
    await transitionOperation(options, operation, { state: 'unknown' });
    if (outcome.outcome === 'absent' || outcome.outcome === 'mismatch' || outcome.outcome === 'unknown') {
      await input.persistence.calendarOperations.putReconciliation({
        schemaVersion: 1, kind: 'calendar-operation-reconciliation',
        userId: input.userId, sessionId: input.sessionId, turnId, operationId: operation.operationId,
        eventId: operation.googleEventId, operationRevision: operation.revision,
        outcome: outcome.outcome === 'absent' ? 'absent' : outcome.outcome === 'mismatch' ? 'mismatch' : 'unknown',
        connectionRevision: operation.connectionRevision, targetRevision: operation.targetRevision,
        checkedAt: input.now(),
      });
    }
  }
}

/**
 * The pending Calendar operation of a session. It is derived from the current
 * graph's own operation and intent references plus a scoped store lookup, never
 * from the session's latest turn alone: an unrelated later text reply must not
 * hide an earlier unknown effect.
 *
 * The lookup is bounded: it reads the saved cursor and seal of the thread and
 * at most three scoped operation records.
 */
export async function pendingCalendarOperation(input: {
  persistence: PersistenceBundle;
  userId: string;
  sessionId: string;
  values: Record<string, unknown>;
  latestTurnId: string | null;
}): Promise<CalendarOperationV2 | CalendarOperation | null> {
  const cursor = input.values.calendarCursor as { version?: number; pendingIntentId?: string | null;
    pendingOperationId?: string | null } | undefined;
  const seal = input.values.calendarSeal as { operationId?: string | null;
    input?: { turn?: { turnId?: string } } } | undefined;
  const candidates: (CalendarOperationV2 | CalendarOperation | null)[] = [];
  const store = input.persistence.calendarOperationsV2;
  // A deployment without the Calendar stores has no pending Calendar work.
  if (!store) return null;
  const sealTurnId = seal?.input?.turn?.turnId;
  if (seal?.operationId && sealTurnId) {
    candidates.push(await store.getByTurn(input.userId, input.sessionId, sealTurnId));
  }
  if (cursor?.pendingIntentId) {
    candidates.push(await store.getByIntent(input.userId, input.sessionId, cursor.pendingIntentId));
  }
  if (sealTurnId) {
    candidates.push(await store.getByTurn(input.userId, input.sessionId, sealTurnId));
  }
  if (input.latestTurnId) {
    candidates.push(await store.getByTurn(input.userId, input.sessionId, input.latestTurnId));
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.state === 'dispatching' || candidate.state === 'unknown') return candidate;
  }
  return null;
}

export function classifyCalendarContinuation(input: {
  sealed: boolean; decisionId: string | null; toolCallId: string | null; operationId: string | null;
}): CalendarContinuation {
  if (input.sealed) throw new AppError('NOT_READY', 'Calendar continuation needs a seal payload.');
  if (input.operationId) return { kind: 'reconcile-operation', operationId: input.operationId };
  if (input.decisionId && input.toolCallId) {
    return { kind: 'reuse-result', decisionId: input.decisionId, toolCallId: input.toolCallId };
  }
  if (input.decisionId) return { kind: 'reuse-decision', decisionId: input.decisionId };
  return { kind: 'interrupt', code: 'EVIDENCE_MISSING' };
}

/**
 * The v2 continuation classifier. It is derived from the durable evidence of
 * the interrupted turn, never from the free-form history:
 *
 * - a decision was saved and no tool effect happened: reuse that exact
 *   decision under the original remaining budget;
 * - a complete retained result was saved: rebuild the group without invoking
 *   the tool or the model again;
 * - a planned operation: the same complete authority plus a fresh final
 *   capability and preflight are required before the first dispatch, otherwise
 *   the turn interrupts or clarifies without changing the immutable
 *   authorization;
 * - a dispatching or unknown operation: only the original readback is allowed;
 * - a succeeded operation: the receipt, the group and the publication;
 * - a sealed turn: the publication only.
 *
 * A model dispatch without a saved terminal decision is an inference outcome
 * that is unknown. It interrupts and is never regenerated automatically.
 */
export function classifyCalendarContinuationV2(input: {
  sealed: boolean;
  decisionId: string | null;
  toolCallId: string | null;
  intentId: string | null;
  operationId: string | null;
  operationState: string | null;
  resultRetained: boolean;
  resultExpired: boolean;
  proposalConsumed: boolean;
  consumptionConfirmed: boolean;
  dispatchedWithoutDecision: boolean;
  deadlinePassed: boolean;
}): CalendarContinuation {
  if (input.sealed) throw new AppError('NOT_READY', 'Calendar continuation needs a seal payload.');
  if (input.operationId) {
    if (input.operationState === 'succeeded') return { kind: 'publish', seal: null };
    if (input.operationState === 'planned') return { kind: 'dispatch-planned', operationId: input.operationId };
    return { kind: 'reconcile-operation', operationId: input.operationId };
  }
  if (input.resultRetained && input.decisionId && input.toolCallId) {
    return { kind: 'reuse-result', decisionId: input.decisionId, toolCallId: input.toolCallId };
  }
  if (input.resultExpired) return { kind: 'interrupt', code: 'EVIDENCE_EXPIRED' };
  // A model dispatch without a saved terminal decision is an inference outcome
  // that is unknown. It interrupts and is never regenerated automatically.
  if (input.dispatchedWithoutDecision) return { kind: 'interrupt', code: 'INFERENCE_OUTCOME_UNKNOWN' };
  if (input.decisionId) return { kind: 'reuse-decision', decisionId: input.decisionId };
  // A consumed proposal with no operation is repaired from the exact
  // consumption, and only while that consumption is confirmed.
  if (input.proposalConsumed && input.consumptionConfirmed && input.intentId) {
    return { kind: 'repair-consumption', intentId: input.intentId };
  }
  if (input.deadlinePassed) return { kind: 'interrupt', code: 'TURN_DEADLINE_EXCEEDED' };
  return { kind: 'interrupt', code: 'EVIDENCE_MISSING' };
}

/**
 * Reconciles one pending v2 operation with a pinned, charged readback of the
 * original event. The readback uses the original accepted turn's persisted
 * budget and deadline, resolves no new default and never binds a replacement
 * account. An absent, mismatched or unknown outcome is never a success: the
 * operation stays unknown and is never retried automatically.
 */
export async function reconcileCalendarOperationV2(input: {
  persistence: PersistenceBundle;
  lease: ExecutionLease;
  job: Work;
  userId: string;
  sessionId: string;
  execution: CalendarExecutionPortV2;
  capabilities: CalendarCapabilityGate;
  operation: CalendarOperationV2;
  attemptId: string;
  trustedTimeZone: string;
  now: () => string;
}): Promise<void> {
  const operation = input.operation;
  if (operation.state !== 'dispatching' && operation.state !== 'unknown') return;
  let currentBudget = await input.persistence.calendarAccountingV2.getBudget(
    input.userId, input.sessionId, operation.turnId);
  const deadlineAt = currentBudget?.deadlineAt ?? operation.auditExpiresAt;
  // A later recovery job never extends the deadline or resets a counter.
  if (Date.parse(deadlineAt) <= Date.parse(input.now())) {
    await markOperationUnknownV2(input, operation);
    return;
  }
  const binding = bindingOfV2(operation);
  // The target is rebuilt from the ORIGINAL operation and a freshly verified
  // EXPLICIT original calendar id under the same subject and connection. No
  // default is resolved and no replacement account is bound.
  const account: CalendarAccountBinding = {
    userId: operation.userId, connectionId: operation.connectionId,
    connectionRevision: operation.connectionRevision, googleSubjectId: operation.googleSubjectId,
  };
  const charge = async (counter: 'calendarRequests' | 'refreshRequests') => {
    input.job.check();
    if (!await input.persistence.owner.fence(input.lease)) throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
    const current = currentBudget ?? await input.persistence.calendarAccountingV2.getBudget(
      input.userId, input.sessionId, operation.turnId);
    if (!current || Date.parse(current.deadlineAt) <= Date.parse(input.now())) {
      throw new AppError('NOT_READY', 'Calendar budget is unavailable.');
    }
    const next = {
      ...current, revision: current.revision + 1, [counter]: current[counter] + 1,
    };
    const outcome = await input.job.wait(input.persistence.owner.run(input.lease, () =>
      input.persistence.calendarAccountingV2.compareAndSwapBudget(current.revision, next)),
      input.persistence.metadata.budgets.persistenceTimeoutMs);
    if (outcome !== 'confirmed') {
      currentBudget = null;
      throw new AppError('PERSISTENCE_ERROR', 'Calendar request admission could not be confirmed.');
    }
    currentBudget = next;
  };
  const resolved = await input.capabilities.resolve({
    account, selector: operation.calendarId, operation: 'read',
    signal: input.job.signal, deadlineAt,
    consumeRequest: () => charge('calendarRequests'),
    consumeRefreshRequest: () => charge('refreshRequests'),
  }).catch(() => null);
  if (!resolved || resolved.outcome !== 'resolved') {
    await markOperationUnknownV2(input, operation);
    return;
  }
  const target = resolved.target;
  const outcome = await input.execution.readback({
    binding: {
      ...account, target, sessionId: input.sessionId, turnId: operation.turnId,
      attemptId: input.attemptId, decisionId: input.attemptId, toolCallId: operation.operationId,
      schemaRevision: 'google-calendar.v2', operation, trustedNow: input.now(),
      trustedTimeZone: input.trustedTimeZone, deadlineAt,
    },
    operation, signal: input.job.signal,
    // The readback is a real provider request and it is charged against the
    // original accepted turn's budget.
    consumeRequest: () => charge('calendarRequests'),
    consumeRefreshRequest: () => charge('refreshRequests'),
  }).catch(() => ({ outcome: 'unknown' as const }));
  if (outcome.outcome === 'matched') {
    const options = writerOptions(input, operation, binding);
    await transitionOperationV2(options, operation, { state: 'succeeded', receipt: outcome.receipt });
    return;
  }
  await markOperationUnknownV2(input, operation);
}

/**
 * Records the bounded reconciliation outcome of an operation whose provider
 * outcome cannot be known. It never grants replay permission.
 */
async function markOperationUnknownV2(
  input: Parameters<typeof reconcileCalendarOperationV2>[0],
  operation: CalendarOperationV2,
): Promise<void> {
  if (operation.state === 'unknown') return;
  const binding = bindingOfV2(operation);
  const options = writerOptions(input, operation, binding);
  await transitionOperationV2(options, operation, { state: 'unknown' });
}

function writerOptions(
  input: Parameters<typeof reconcileCalendarOperationV2>[0],
  operation: CalendarOperationV2,
  binding: CalendarConnectionBinding,
): CalendarOperationWriterOptions {
  return {
    operations: input.persistence.calendarOperations,
    operationsV2: input.persistence.calendarOperationsV2,
    executionV2: input.execution,    write: action => input.job.wait(input.persistence.owner.run(input.lease, action), 15000),
    ledger: null as never,
    identity: {
      userId: input.userId, sessionId: input.sessionId,
      turnId: operation.turnId, attemptId: input.attemptId,
    },
    binding, clock: Date.now, job: input.job,
    fence: () => input.persistence.owner.fence(input.lease),
    requireCurrent: async () => undefined,
    permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'fixture-policy' },
    trustedTimeZone: input.trustedTimeZone,
  };
}

