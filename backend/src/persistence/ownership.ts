/**
 * ============================================================================
 * FILE: ownership.ts
 * LOCATION: backend/src/persistence/ownership.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Admit one executor and expose guarded session ownership primitives.
 *
 * ROLE IN PROJECT:
 *    Claims a durable executor sentinel, taking over a leftover one so watch
 *    reloads and unsafe exits can boot, and exposes session leases for P5.
 *
 * KEY COMPONENTS:
 *    - claimExecutor/handoffStoppedExecutor: Sentinel without TTL; leftover takeover.
 *    - acquire/fence/run/renew/release: Conditional per-session ownership.
 *    - allocateSequences/confirmAcceptance: Ordering and acceptance evidence.
 * ============================================================================
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Filter } from 'mongodb';
import { attemptRecordSchema, type AttemptRecord } from '../contracts/attempt.js';
import { idSchema } from '../contracts/identifiers.js';
import { messageRecordSchema, type MessageRecord } from '../contracts/message.js';
import type {
  AcquireExecutionResult,
  ExecutionLease,
  ExecutionOwnership,
  OwnedPhaseName,
  OwnedPhaseOptions,
} from '../contracts/repositories.js';
import { sessionRecordSchema, type SessionRecord } from '../contracts/session.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { AppError } from '../platform/errors/app-error.js';
import { inspectConfirmedRecord, type ConfirmedRecord } from './confirmed-record.js';

export type { OwnedPhaseName, OwnedPhaseOptions };
export type AcceptanceRecord = ReturnType<typeof acceptanceSchema.parse>;

type PhaseToken = {
  readonly ownerId: string;
  readonly lease: ExecutionLease;
  readonly options: OwnedPhaseOptions;
  readonly decodedSession: StoredDocument;
  active: boolean;
  operationCount: number;
  latchedError: unknown | null;
  readonly operations: Set<Promise<unknown>>;
};
import {
  acceptanceSchema,
  counterSchema,
  decode,
  EXECUTOR_SCOPE,
  executorSchema,
  key,
  normalizeDate,
  localBindingSchema,
  LOCAL_MUTATION_MODE,
  bounded,
  reservationSchema,
  safeSequence,
  type LocalBinding,
  type StoredDocument,
} from './records.js';
import { RecordStore } from './store.js';
import type { MutationJournal } from './mutation-journal.js';

export class MongoOwnership implements ExecutionOwnership {
  private tail: Promise<void> = Promise.resolve();
  private readonly phaseStorage = new AsyncLocalStorage<PhaseToken>();
  onQueueWait?: (elapsedMs: number) => void;
  onOrigin?: <T>(origin: 'ownership', action: () => T) => T;

  constructor(
    readonly store: RecordStore,
    readonly executorId: string = randomUUID(),
    readonly now = Date.now,
    readonly controlStore: RecordStore = store,
    readonly journal?: MutationJournal,
  ) {
    idSchema.parse(executorId);
    this.store.beforeMutation = () => this.checkBeforeMutation();
  }

  private checkBeforeMutation(): void {
    const token = this.phaseStorage.getStore();
    if (!token) return;
    if (!token.active || token.latchedError) {
      throw new AppError('INTERRUPTED', 'Execution ownership was lost or phase was interrupted.');
    }
    const now = this.now();
    if (now > token.options.deadlineAt || now >= Date.parse(token.lease.leaseExpiresAt)) {
      token.latchedError = new AppError('INTERRUPTED', 'Phase deadline exceeded or lease expired.');
      throw token.latchedError;
    }
    this.journal?.assertHealthy();
  }

  currentPhaseSession(): StoredDocument | null {
    return this.phaseStorage.getStore()?.decodedSession ?? null;
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const restoreScope = AsyncLocalStorage.snapshot();
    const queuedAt = performance.now();
    const result = this.tail.then(() =>
      restoreScope(() => {
        try { this.onQueueWait?.(performance.now() - queuedAt); } catch { /* Observation cannot affect ownership. */ }
        return this.onOrigin ? this.onOrigin('ownership', action) : action();
      }),
    );
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async claimExecutor(local?: LocalBinding): Promise<void> {
    return this.exclusive(async () => {
      await this.claimExecutorCore(local);
    });
  }

  private async claimExecutorCore(local?: LocalBinding): Promise<void> {
    if (local) {
      const binding = localBindingSchema.parse(local);
      const existing = await this.controlStore.raw('metadata', { _id: key('executor'), ...EXECUTOR_SCOPE, kind: 'executor' });
      if (existing) {
        const saved = decode(executorSchema, existing)!;
        if (saved.ownerId === this.executorId && saved.local?.released === false && isDeepStrictEqual(saved.local.binding, binding)) return;
        throw new AppError('UNSUPPORTED_TOPOLOGY', 'Another executor owns this database.');
      }
      const unfinished = await this.store.collection('sessions').findOne({ $or: [
        { 'execution.ownerId': { $ne: null } }, { 'execution.activeAttemptId': { $ne: null } },
      ] }, this.store.options());
      if (unfinished) throw new AppError('NOT_READY', 'Unbound legacy work requires operator recovery.');
      const { doc }=bounded(executorSchema,{ schemaVersion:1,kind:'executor',...EXECUTOR_SCOPE,ownerId:this.executorId,
        local:{ mode:LOCAL_MUTATION_MODE,released:false,binding,mutation:{ state:'busy',token:randomUUID() },ancestors:[],pending:false } },
      key('executor'),16384);
      const result=await this.controlStore.collection('metadata').insertOne(doc,{ ...this.controlStore.options(),
        timeoutMS:this.controlStore.timeoutMs,writeConcern:{ w:'majority',j:true } });
      if (!result.acknowledged) throw new AppError('NOT_READY','Local bootstrap was not acknowledged.');
      return; // No ambiguous-result reread may authorize dispatch of bootstrap writes.
    }
    try {
      await this.controlStore.insert(
        'metadata',
        executorSchema,
        {
          schemaVersion: 1,
          kind: 'executor',
          ...EXECUTOR_SCOPE,
          ownerId: this.executorId,
        },
        key('executor'),
        16384,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
        const existing = await this.controlStore.read('metadata', executorSchema, {
          _id: key('executor'),
          ...EXECUTOR_SCOPE,
          kind: 'executor',
        });
        if (existing?.ownerId === this.executorId) return;
        if (!existing) {
          throw new AppError(
            'UNSUPPORTED_TOPOLOGY',
            'Another executor owns this database.',
          );
        }
        // ponytail: leftover sentinel from watch-kill/unsafe exit is taken over
        // so the next process can listen; two live backends still race on CAS.
        await this.handoffStoppedExecutorCore(existing.ownerId);
        return;
      }
      throw error;
    }
  }

  async assertExecutor(): Promise<void> {
    const check = async () => {
      this.journal?.assertHealthy();
      const doc = await this.controlStore.read('metadata', executorSchema, {
        _id: key('executor'),
        ...EXECUTOR_SCOPE,
        kind: 'executor',
      });
      if (doc?.ownerId !== this.executorId || doc.local?.released) {
        throw new AppError(
          'UNSUPPORTED_TOPOLOGY',
          'This process is not the active executor.',
        );
      }
    };
    return this.onOrigin ? this.onOrigin('ownership', check) : check();
  }

  async observedExecutor() {
    const doc = await this.controlStore.raw('metadata', { _id: key('executor'), ...EXECUTOR_SCOPE, kind: 'executor' });
    if (!doc || !Number.isSafeInteger(doc._revision) || doc._revision < 0)
      throw new AppError('NOT_READY', 'Executor recovery evidence is unavailable.');
    return { record: decode(executorSchema, doc)!, revision: doc._revision };
  }

  async handoffStoppedExecutor(previousExecutorId: string, observed?: {
    revision: number;
    local: NonNullable<ReturnType<typeof executorSchema.parse>['local']>;
  }): Promise<void> {
    return this.exclusive(async () => {
      await this.handoffStoppedExecutorCore(previousExecutorId, observed);
    });
  }

  private async handoffStoppedExecutorCore(previousExecutorId: string, observed?: {
    revision: number;
    local: NonNullable<ReturnType<typeof executorSchema.parse>['local']>;
  }): Promise<void> {
    if (observed) {
      const { doc }=bounded(executorSchema,{ schemaVersion:1,kind:'executor',...EXECUTOR_SCOPE,
        ownerId:this.executorId,local:observed.local },key('executor'),16384);
      doc._revision=observed.revision+1;
      const result=await this.controlStore.collection('metadata').replaceOne({ _id:key('executor'),...EXECUTOR_SCOPE,
        kind:'executor',ownerId:previousExecutorId,_revision:observed.revision,
        'local.mode':LOCAL_MUTATION_MODE,'local.mutation.state':'idle','local.mutation.token':null,
      },doc,{ ...this.controlStore.options(),timeoutMS:this.controlStore.timeoutMs,writeConcern:{ w:'majority',j:true } });
      if (!result.acknowledged || result.matchedCount !== 1)
        throw new AppError('UNSUPPORTED_TOPOLOGY','Idle executor handoff could not be confirmed.');
      return;
    }
    const doc = await this.controlStore.raw('metadata', {
      _id: key('executor'),
      ...EXECUTOR_SCOPE,
      kind: 'executor',
      ownerId: previousExecutorId,
    });
    if (
      !doc ||
      !(await this.controlStore.replace(
        'metadata',
        executorSchema,
        {
          schemaVersion: 1,
          kind: 'executor',
          ...EXECUTOR_SCOPE,
          ownerId: this.executorId,
        },
        key('executor'),
        doc._revision,
        16384,
      ))
    ) {
      throw new AppError(
        'UNSUPPORTED_TOPOLOGY',
        'Executor handoff could not be confirmed.',
      );
    }
  }

  private leaseFilter(lease: ExecutionLease): Filter<StoredDocument> {
    return {
      _id: key('session', lease.userId, lease.sessionId),
      userId: lease.userId,
      sessionId: lease.sessionId,
      'execution.ownerId': lease.ownerId,
      'execution.generation': lease.generation,
    };
  }

  async acquire(input: {
    userId: string;
    sessionId: string;
    ownerId: string;
    leaseMs: number;
    expectedGeneration?: number;
  }): Promise<AcquireExecutionResult> {
    return this.exclusive(async () => {
      await this.assertExecutor();
      if (
        input.ownerId !== this.executorId ||
        !Number.isInteger(input.leaseMs) ||
        input.leaseMs < 1 ||
        input.leaseMs > 180_000
      ) {
        throw new AppError('INVALID_REQUEST', 'Invalid execution ownership request.');
      }
      const base = {
        _id: key('session', input.userId, input.sessionId),
        userId: idSchema.parse(input.userId),
        sessionId: idSchema.parse(input.sessionId),
      };
      const old = decode(sessionRecordSchema, await this.store.raw('sessions', base));
      if (
        !old ||
        old.lifecycle !== 'active' ||
        old.execution.ownerId !== null ||
        old.execution.activeAttemptId !== null
      ) {
        return { ok: false, code: 'CONFLICT_ACTIVE_TURN' };
      }
      const generation = safeSequence(old.execution.generation);
      if (generation === Number.MAX_SAFE_INTEGER) {
        throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Ownership capacity exceeded.');
      }
      if (
        input.expectedGeneration !== undefined &&
        input.expectedGeneration !== generation
      ) {
        return { ok: false, code: 'CONFLICT_ACTIVE_TURN' };
      }
      const filter: Filter<StoredDocument> = {
        ...base,
        lifecycle: 'active',
        'execution.ownerId': null,
        'execution.activeAttemptId': null,
        'execution.generation': generation,
      };
      const expiry = new Date(this.now() + input.leaseMs).toISOString();
      let record: StoredDocument | null;
      try {
        record = await this.store.collection('sessions').findOneAndUpdate(
          filter,
          {
            $set: {
              'execution.ownerId': input.ownerId,
              'execution.leaseExpiresAt': expiry,
            },
            $inc: { 'execution.generation': 1, _revision: 1 },
          },
          {
            returnDocument: 'after',
            includeResultMetadata: false,
            ...this.store.options(),
          },
        );
      } catch {
        record = await this.store.raw('sessions', {
          ...base,
          'execution.ownerId': input.ownerId,
          'execution.generation': generation + 1,
          'execution.leaseExpiresAt': expiry,
        });
        if (!record) {
          throw new AppError('PERSISTENCE_ERROR', 'Ownership could not be confirmed.');
        }
      }
      if (!record) {
        return { ok: false, code: 'CONFLICT_ACTIVE_TURN' };
      }
      const saved = decode(sessionRecordSchema, record)!;
      return {
        ok: true,
        session: saved,
        lease: {
          userId: input.userId,
          sessionId: input.sessionId,
          ownerId: input.ownerId,
          generation: saved.execution.generation,
          leaseExpiresAt: expiry,
        },
      };
    });
  }

  async fenceSession(lease: ExecutionLease): Promise<StoredDocument | null> {
    const phase = this.phaseStorage.getStore();
    if (
      phase?.active
      && !phase.latchedError
      && phase.lease.userId === lease.userId
      && phase.lease.sessionId === lease.sessionId
      && phase.lease.ownerId === lease.ownerId
      && phase.lease.generation === lease.generation
    ) {
      return phase.decodedSession;
    }
    await this.assertExecutor();
    if (lease.ownerId !== this.executorId) {
      return null;
    }
    return this.store.raw('sessions', {
      ...this.leaseFilter(lease),
      'execution.leaseExpiresAt': { $gt: new Date(this.now()).toISOString() },
    });
  }

  async fence(lease: ExecutionLease): Promise<boolean> {
    return Boolean(await this.fenceSession(lease));
  }

  async runPhase<T>(
    lease: ExecutionLease,
    options: OwnedPhaseOptions,
    action: () => Promise<T>,
  ): Promise<T> {
    const activeToken = this.phaseStorage.getStore();
    if (activeToken) {
      throw new AppError('INVALID_REQUEST', 'Nested phases are not permitted.');
    }
    if (this.journal) {
      return action();
    }
    const restoreCaller = AsyncLocalStorage.snapshot();
    return this.exclusive(async () => {
      const now = this.now();
      if (now > options.deadlineAt || now >= Date.parse(lease.leaseExpiresAt)) {
        throw new AppError('INTERRUPTED', 'Phase deadline exceeded or lease expired.');
      }
      const sessionDoc = await this.fenceSession(lease);
      if (!sessionDoc) {
        throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
      }
      const token: PhaseToken = {
        ownerId: this.executorId,
        lease,
        options,
        decodedSession: sessionDoc,
        active: true,
        operationCount: 0,
        latchedError: null,
        operations: new Set(),
      };
      return restoreCaller(() => {
        return this.phaseStorage.run(token, async () => {
          try {
            return await action();
          } catch (error) {
            token.latchedError ??= error;
            throw error;
          } finally {
            try {
              await Promise.allSettled(Array.from(token.operations));
            } finally {
              token.active = false;
            }
          }
        });
      });
    });
  }

  async run<T>(lease: ExecutionLease, action: () => Promise<T>): Promise<T> {
    const token = this.phaseStorage.getStore();
    if (token) {
      if (
        token.lease.userId !== lease.userId ||
        token.lease.sessionId !== lease.sessionId ||
        token.lease.ownerId !== lease.ownerId ||
        token.lease.generation !== lease.generation
      ) {
        throw new AppError('INVALID_REQUEST', 'Lease does not match active phase.');
      }
      if (!token.active || token.latchedError) {
        throw new AppError('INTERRUPTED', 'Execution ownership was lost or phase was interrupted.');
      }
      const now = this.now();
      if (now > token.options.deadlineAt || now >= Date.parse(token.lease.leaseExpiresAt)) {
        token.latchedError = new AppError('INTERRUPTED', 'Phase deadline exceeded or lease expired.');
        throw token.latchedError;
      }
      if (token.operationCount >= token.options.maxOperations) {
        token.latchedError = new AppError('STORAGE_BUDGET_EXCEEDED', 'Phase operation limit exceeded.');
        throw token.latchedError;
      }
      this.journal?.assertHealthy();
      token.operationCount++;
      const opPromise = (async () => {
        try {
          return await action();
        } catch (error) {
          token.latchedError ??= error;
          throw error;
        }
      })();
      token.operations.add(opPromise);
      void opPromise.then(
        () => token.operations.delete(opPromise),
        () => token.operations.delete(opPromise),
      );
      return opPromise;
    }

    const restoreCaller = AsyncLocalStorage.snapshot();
    return this.exclusive(async () => {
      if (!(await this.fence(lease))) {
        throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
      }
      return restoreCaller(action);
    });
  }

  async renew(lease: ExecutionLease, leaseMs: number): Promise<ExecutionLease> {
    return this.run(lease, async () => {
      if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 180_000) {
        throw new AppError('INVALID_REQUEST', 'Invalid lease duration.');
      }
      const expiry = new Date(this.now() + leaseMs).toISOString();
      const result = await this.store
        .collection('sessions')
        .updateOne(
          this.leaseFilter(lease),
          { $set: { 'execution.leaseExpiresAt': expiry }, $inc: { _revision: 1 } },
          this.store.options(),
        );
      if (!result.matchedCount) {
        throw new AppError('INTERRUPTED', 'Execution ownership was lost.');
      }
      return { ...lease, leaseExpiresAt: expiry };
    });
  }

  async release(lease: ExecutionLease): Promise<void> {
    await this.exclusive(async () => {
      await this.assertExecutor();
      await this.store
        .collection('sessions')
        .updateOne(
          this.leaseFilter(lease),
          {
            $set: { 'execution.ownerId': null, 'execution.leaseExpiresAt': null },
            $inc: { _revision: 1 },
          },
          this.store.options(),
        );
    });
  }

  async recoverStoppedSession(
    userId: string,
    sessionId: string,
    previousOwnerId: string | null,
    leaseMs: number,
  ): Promise<ExecutionLease> {
    return this.exclusive(async () => {
      await this.assertExecutor();
      if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 180_000) {
        throw new AppError('INVALID_REQUEST', 'Invalid lease duration.');
      }
      const expiry = new Date(this.now() + leaseMs).toISOString();
      const doc = await this.store.collection('sessions').findOneAndUpdate(
        {
          _id: key('session', userId, sessionId),
          userId,
          sessionId,
          'execution.ownerId': previousOwnerId,
          'execution.generation': { $lt: Number.MAX_SAFE_INTEGER },
        },
        {
          $set: {
            'execution.ownerId': this.executorId,
            'execution.leaseExpiresAt': expiry,
          },
          $inc: { 'execution.generation': 1, _revision: 1 },
        },
        {
          returnDocument: 'after',
          includeResultMetadata: false,
          ...this.store.options(),
        },
      );
      if (!doc) {
        throw new AppError(
          'CONFLICT_ACTIVE_TURN',
          'Recovery ownership could not be obtained.',
        );
      }
      const saved = decode(sessionRecordSchema, doc)!;
      return {
        userId,
        sessionId,
        ownerId: this.executorId,
        generation: saved.execution.generation,
        leaseExpiresAt: expiry,
      };
    });
  }

  async drain(): Promise<void> {
    await this.tail;
    await this.journal?.drain();
  }

  async releaseExecutor(): Promise<void> {
    await this.exclusive(async () => {
      const doc = await this.controlStore.raw('metadata', { _id: key('executor'), ...EXECUTOR_SCOPE, kind: 'executor' });
      if (!doc) return;
      const executor = { record: decode(executorSchema, doc)!, revision: doc._revision };
      if (executor.record.ownerId !== this.executorId || executor.record.local?.pending)
        throw new AppError('NOT_READY', 'Pending executor recovery evidence must be retained.');
      const active = await this.store
        .collection('sessions')
        .findOne({ 'execution.ownerId': this.executorId }, this.store.options());
      if (active) {
        throw new AppError('NOT_READY', 'Executor still owns chat work.');
      }
      if (executor.record.local && await this.store.collection('sessions').findOne({ $or:[
        { 'execution.ownerId':{ $ne:null } },{ 'execution.activeAttemptId':{ $ne:null } },
      ] },this.store.options()))
        throw new AppError('NOT_READY','Unfinished local work retains the idle sentinel for next startup recovery.');
      if (executor.record.local && executor.record.local.mutation.state !== 'idle')
        throw new AppError('NOT_READY','Uncertain local mutations retain the executor sentinel.');
      if (executor.record.local) {
        // Retain binding/provenance across graceful exits; another PC cannot claim an empty sentinel.
        const result=await this.controlStore.collection('metadata').updateOne({ _id:key('executor'),...EXECUTOR_SCOPE,
          kind:'executor',ownerId:this.executorId,_revision:executor.revision,'local.mode':LOCAL_MUTATION_MODE,
          'local.mutation.state':'idle','local.mutation.token':null },
        { $set:{ 'local.released':true },$inc:{ _revision:1 } },
        { ...this.controlStore.options(),timeoutMS:this.controlStore.timeoutMs,writeConcern:{ w:'majority',j:true } });
        if (!result.acknowledged || result.matchedCount !== 1)
          throw new AppError('NOT_READY','Local executor release could not be confirmed.');
        return;
      }
      await this.controlStore
        .collection('metadata')
        .deleteOne(
          {
            _id: key('executor'),
            ...EXECUTOR_SCOPE,
            kind: 'executor',
            ownerId: this.executorId,
            _revision: executor.revision,
            ...(executor.record.local ? { 'local.mode':LOCAL_MUTATION_MODE,'local.mutation.state':'idle',
              'local.mutation.token':null } : {}),
          },
          { ...this.controlStore.options(),writeConcern:{ w:'majority',j:true } },
        );
    });
  }

  async finishLocalRecovery(): Promise<void> {
    await this.exclusive(async () => {
      this.journal?.assertHealthy();
      const observed = await this.observedExecutor();
      if (observed.record.ownerId !== this.executorId || !observed.record.local)
        throw new AppError('NOT_READY', 'Local recovery ownership is unavailable.');
      const unfinished = await this.store.collection('sessions').findOne({ $or: [
        { 'execution.ownerId': { $ne: null } }, { 'execution.activeAttemptId': { $ne: null } },
      ] }, this.store.options());
      const local=observed.record.local;
      if (unfinished || local.released || local.mutation.state !== 'idle')
        throw new AppError('NOT_READY', 'Local recovery completion could not be confirmed.');
      const result=await this.controlStore.collection('metadata').updateOne({ _id:key('executor'),...EXECUTOR_SCOPE,
        kind:'executor',ownerId:this.executorId,_revision:observed.revision,'local.mode':LOCAL_MUTATION_MODE,
        'local.mutation.state':'idle','local.mutation.token':null },
      { $set:{ 'local.ancestors':[],'local.pending':false },$inc:{ _revision:1 } },
      { ...this.controlStore.options(),writeConcern:{ w:'majority',j:true },timeoutMS:this.controlStore.timeoutMs });
      if (!result.acknowledged || result.matchedCount !== 1)
        throw new AppError('NOT_READY','Local recovery completion could not be confirmed.');
    });
  }

  async allocateSequences(
    lease: ExecutionLease,
    reservationId: string,
    count: number,
  ) {
    return this.run(lease, async () => {
      idSchema.parse(reservationId);
      if (!Number.isInteger(count) || count < 1 || count > 80) {
        throw new AppError('INVALID_REQUEST', 'Invalid sequence reservation.');
      }
      const scope = { userId: lease.userId, sessionId: lease.sessionId };
      const id = key(
        'sequence-reservation',
        lease.userId,
        lease.sessionId,
        reservationId,
      );
      const existing = await this.store.read('metadata', reservationSchema, {
        _id: id,
        ...scope,
      });
      if (existing) {
        if (existing.count !== count) {
          throw new AppError(
            'IDEMPOTENCY_PAYLOAD_MISMATCH',
            'Sequence reservation changed.',
          );
        }
        return existing;
      }
      const counterId = key('sequence-counter', lease.userId, lease.sessionId);
      const rawCounter = await this.store.raw('metadata', { _id: counterId, ...scope });
      if (!rawCounter) {
        const [priorMessage, priorReservation] = await Promise.all([
          this.store.collection('messages').findOne(scope, this.store.options()),
          this.store.collection('metadata').findOne({ ...scope, kind: 'sequence-reservation' }, this.store.options()),
        ]);
        if (priorMessage || priorReservation) {
          throw new AppError(
            'NOT_READY',
            'Ordering state needs restore reconciliation.',
          );
        }
        await this.store.insert(
          'metadata',
          counterSchema,
          {
            schemaVersion: 1,
            kind: 'sequence-counter',
            ...scope,
            next: 0,
          },
          counterId,
          4096,
        );
      }
      const counter = await this.store.collection('metadata').findOneAndUpdate(
        { _id: counterId, ...scope, next: { $lte: Number.MAX_SAFE_INTEGER - count } },
        { $inc: { next: count, _revision: 1 } },
        {
          returnDocument: 'before',
          includeResultMetadata: false,
          ...this.store.options(),
        },
      );
      if (!counter) {
        throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Ordering capacity exceeded.');
      }
      const record = {
        schemaVersion: 1 as const,
        kind: 'sequence-reservation' as const,
        ...scope,
        reservationId,
        start: safeSequence(counter.next as number),
        count,
      };
      return this.store.insert('metadata', reservationSchema, record, id, 4096);
    });
  }

  async reserveAttempt(lease: ExecutionLease, attemptId: string): Promise<void> {
    await this.run(lease, async () => {
      idSchema.parse(attemptId);
      const result = await this.store.collection('sessions').updateOne(
        {
          ...this.leaseFilter(lease),
          $or: [
            { 'execution.activeAttemptId': null },
            { 'execution.activeAttemptId': attemptId },
          ],
        },
        { $set: { 'execution.activeAttemptId': attemptId }, $inc: { _revision: 1 } },
        this.store.options(),
      );
      if (!result.matchedCount) {
        throw new AppError('CONFLICT_ACTIVE_TURN', 'Another turn is active.');
      }
    });
  }

  async confirmAcceptance(
    lease: ExecutionLease,
    attemptId: string,
    evidence?: {
      input: ConfirmedRecord<MessageRecord>;
      attempt: ConfirmedRecord<AttemptRecord>;
    },
  ): Promise<AcceptanceRecord> {
    return this.run(lease, async () => {
      const scope = { userId: lease.userId, sessionId: lease.sessionId };
      let inputRecord: MessageRecord;
      let attemptRecord: AttemptRecord;
      if (evidence) {
        const inputEnv = inspectConfirmedRecord<MessageRecord>(evidence.input, { store: this.store });
        const attemptEnv = inspectConfirmedRecord<AttemptRecord>(evidence.attempt, { store: this.store });
        if (
          attemptEnv.canonical.attemptId !== attemptId ||
          attemptEnv.canonical.userId !== lease.userId ||
          attemptEnv.canonical.sessionId !== lease.sessionId ||
          inputEnv.canonical.userId !== lease.userId ||
          inputEnv.canonical.sessionId !== lease.sessionId ||
          inputEnv.canonical.role !== 'user' ||
          inputEnv.canonical.turnId !== attemptEnv.canonical.turnId ||
          attemptEnv.canonical.causal.userMessageId !== inputEnv.canonical.messageId ||
          hashPayload(inputEnv.canonical.content) !== attemptEnv.canonical.payloadHash
        ) {
          throw new AppError('INVALID_REQUEST', 'Receipt evidence mismatch for acceptance.');
        }
        inputRecord = inputEnv.canonical;
        attemptRecord = attemptEnv.canonical;
      } else {
        const attempt = await this.store.read('metadata', attemptRecordSchema, {
          ...scope,
          kind: 'attempt',
          attemptId,
        });
        const input = attempt
          ? await this.store.read('messages', messageRecordSchema, {
              ...scope,
              _id: key(
                'message',
                lease.userId,
                lease.sessionId,
                attempt.causal.userMessageId,
              ),
            })
          : null;
        if (
          !attempt ||
          !input ||
          input.role !== 'user' ||
          input.turnId !== attempt.turnId ||
          hashPayload(input.content) !== attempt.payloadHash
        ) {
          throw new AppError('NOT_READY', 'Accepted chat data needs recovery.');
        }
        inputRecord = input;
        attemptRecord = attempt;
      }
      const marker = {
        schemaVersion: 1 as const,
        kind: 'acceptance' as const,
        ...scope,
        turnId: attemptRecord.turnId,
        attemptId,
        userMessageId: inputRecord.messageId,
        payloadHash: attemptRecord.payloadHash,
      };
      await this.store.insert(
        'metadata',
        acceptanceSchema,
        marker,
        key('acceptance', lease.userId, lease.sessionId, attemptId),
        4096,
      );
      const result = await this.store.collection('sessions').updateOne(
        { ...this.leaseFilter(lease), 'execution.activeAttemptId': attemptId },
        { $set: { latestTurnId: attemptRecord.turnId }, $inc: { _revision: 1 } },
        this.store.options(),
      );
      if (!result.matchedCount) {
        const saved = await this.store.raw('sessions', {
          ...this.leaseFilter(lease),
          'execution.activeAttemptId': attemptId,
        });
        if (!saved || saved.latestTurnId !== attemptRecord.turnId) {
          throw new AppError('INTERRUPTED', 'Acceptance ownership was lost.');
        }
      }
      return marker;
    });
  }

  async detachAccepted(
    lease: ExecutionLease,
    attemptId: string,
  ): Promise<{ releasedGeneration: number }> {
    return this.exclusive(async () => {
      await this.assertExecutor();
      const filter = {
        ...this.leaseFilter(lease),
        'execution.activeAttemptId': attemptId,
      };
      let record: StoredDocument | null = null;
      try {
        record = await this.store.collection('sessions').findOneAndUpdate(
          filter,
          {
            $set: {
              'execution.ownerId': null,
              'execution.leaseExpiresAt': null,
            },
            $inc: { 'execution.generation': 1, _revision: 1 },
          },
          {
            returnDocument: 'after',
            includeResultMetadata: false,
            ...this.store.options(),
          },
        );
      } catch {
        /* confirm below */
      }
      if (!record) {
        const saved = await this.store.raw('sessions', {
          _id: key('session', lease.userId, lease.sessionId),
          userId: lease.userId,
          sessionId: lease.sessionId,
          'execution.activeAttemptId': attemptId,
          'execution.ownerId': null,
          'execution.generation': lease.generation + 1,
        });
        if (saved) {
          record = saved;
        } else {
          throw new AppError('CONFLICT_ACTIVE_TURN', 'Admission release could not be confirmed.');
        }
      }
      const savedSession = decode(sessionRecordSchema, record)!;
      return { releasedGeneration: savedSession.execution.generation };
    });
  }

  async attachAccepted(input: {
    userId: string;
    sessionId: string;
    attemptId: string;
    expectedGeneration?: number;
    leaseMs: number;
  }): Promise<{ lease: ExecutionLease; session: SessionRecord }> {
    return this.exclusive(async () => {
      await this.assertExecutor();
      if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > 180_000) {
        throw new AppError('INVALID_REQUEST', 'Invalid lease duration.');
      }
      const at = this.now();
      const leaseExpiresAt = new Date(at + input.leaseMs).toISOString();
      const baseFilter: Filter<StoredDocument> = {
        _id: key('session', input.userId, input.sessionId),
        userId: idSchema.parse(input.userId),
        sessionId: idSchema.parse(input.sessionId),
        lifecycle: 'active',
        'execution.ownerId': null,
        'execution.activeAttemptId': idSchema.parse(input.attemptId),
        ...(input.expectedGeneration !== undefined ? { 'execution.generation': input.expectedGeneration } : {}),
      };
      let record: StoredDocument | null = null;
      try {
        record = await this.store.collection('sessions').findOneAndUpdate(
          baseFilter,
          {
            $set: {
              'execution.ownerId': this.executorId,
              'execution.leaseExpiresAt': leaseExpiresAt,
            },
            $inc: { 'execution.generation': 1, _revision: 1 },
          },
          {
            returnDocument: 'after',
            includeResultMetadata: false,
            ...this.store.options(),
          },
        );
      } catch {
        /* ambiguous write: readback below */
      }
      if (!record) {
        const readbackFilter: Filter<StoredDocument> = {
          _id: key('session', input.userId, input.sessionId),
          userId: input.userId,
          sessionId: input.sessionId,
          lifecycle: 'active',
          'execution.ownerId': this.executorId,
          'execution.activeAttemptId': input.attemptId,
          ...(input.expectedGeneration !== undefined ? { 'execution.generation': input.expectedGeneration + 1 } : {}),
        };
        const saved = await this.store.raw('sessions', readbackFilter);
        if (saved) {
          record = saved;
        } else {
          throw new AppError('CONFLICT_ACTIVE_TURN', 'Stream attachment could not be confirmed.');
        }
      }
      const session = decode(sessionRecordSchema, record);
      if (!session) {
        throw new AppError('CONFLICT_ACTIVE_TURN', 'Stream attachment session decode failed.');
      }
      const lease: ExecutionLease = {
        ownerId: this.executorId,
        userId: input.userId,
        sessionId: input.sessionId,
        leaseExpiresAt: session.execution.leaseExpiresAt ?? leaseExpiresAt,
        generation: session.execution.generation,
      };
      return { lease, session };
    });
  }

  async finishAttempt(
    lease: ExecutionLease,
    terminalAttemptReceipt: ConfirmedRecord<AttemptRecord>,
    activityAt: string,
  ): Promise<void> {
    await this.exclusive(async () => {
      await this.assertExecutor();
      const attemptEnv = inspectConfirmedRecord<AttemptRecord>(terminalAttemptReceipt, { store: this.store });
      const attempt = attemptEnv.canonical;
      if (
        !['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(attempt.status) ||
        attempt.userId !== lease.userId ||
        attempt.sessionId !== lease.sessionId
      ) {
        throw new AppError('NOT_READY', 'Terminal attempt confirmation is required.');
      }
      const filter = {
        ...this.leaseFilter(lease),
        'execution.activeAttemptId': attempt.attemptId,
      };
      const result = await this.store.collection('sessions').updateOne(
        filter,
        {
          $set: {
            'execution.ownerId': null,
            'execution.leaseExpiresAt': null,
            'execution.activeAttemptId': null,
          },
          // The activity touch never regresses an already newer timestamp.
          $max: {
            lastActivityAt: normalizeDate(activityAt),
            updatedAt: normalizeDate(activityAt),
          },
          $inc: { _revision: 1 },
        },
        this.store.options(),
      );
      if (!result.matchedCount) {
        const saved = await this.store.raw('sessions', {
          _id: key('session', lease.userId, lease.sessionId),
          userId: lease.userId,
          sessionId: lease.sessionId,
          'execution.ownerId': null,
          'execution.activeAttemptId': null,
        });
        if (!saved) {
          throw new AppError('CONFLICT_ACTIVE_TURN', 'Session completion release could not be confirmed.');
        }
        // A newer owner may already have taken the session over; its generation
        // then differs and this release no longer confirms the activity touch.
        if (saved.execution.generation !== lease.generation) return;
        if (Date.parse(String(saved.lastActivityAt ?? '')) < Date.parse(activityAt)) {
          throw new AppError('CONFLICT_ACTIVE_TURN', 'Session activity could not be confirmed.');
        }
      }
    });
  }

  async clearAttempt(lease: ExecutionLease, attemptId: string): Promise<void> {
    await this.run(lease, async () => {
      const attempt = await this.store.read('metadata', attemptRecordSchema, {
        userId: lease.userId,
        sessionId: lease.sessionId,
        kind: 'attempt',
        attemptId,
      });
      if (
        attempt &&
        !['completed', 'truncated', 'failed', 'cancelled', 'interrupted'].includes(
          attempt.status,
        )
      ) {
        throw new AppError('NOT_READY', 'The attempt is not finalized.');
      }
      const result = await this.store.collection('sessions').updateOne(
        { ...this.leaseFilter(lease), 'execution.activeAttemptId': attemptId },
        { $set: { 'execution.activeAttemptId': null }, $inc: { _revision: 1 } },
        this.store.options(),
      );
      if (!result.matchedCount) {
        const saved = await this.store.raw('sessions', this.leaseFilter(lease));
        if (!saved || saved.execution.activeAttemptId !== null) {
          throw new AppError('CONFLICT_ACTIVE_TURN', 'Attempt ownership changed.');
        }
      }
    });
  }
}
