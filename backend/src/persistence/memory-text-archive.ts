/**
 * ============================================================================
 * FILE: memory-text-archive.ts
 * LOCATION: backend/src/persistence/memory-text-archive.ts
 * ============================================================================
 * PURPOSE: Project terminal conversation and voice accounting through the native store.
 * ROLE IN PROJECT: Save-only adapter; shares ownership/client and never invokes inference.
 * KEY COMPONENTS: Immutable terminal IDs, ordered dependencies, checkpoint and visibility CAS.
 * ============================================================================
 */
import { isDeepStrictEqual } from 'node:util';
import type { Document } from 'mongodb';
import type { ZodType, ZodTypeDef } from 'zod';
import type { PersistenceBundle } from './persistence.js';
import type { FixedAssets } from '../instructions/fixed-assets.js';
import type { SaveTerminal, TerminalEnvelope, SaveOutcome } from '../chat-runtime/memory-first-foundation.js';
import type { SaveVoiceObservation } from '../chat-runtime/memory-first-foundation.js';
import { voiceAccountingRecordSchema } from '../contracts/voice-accounting.js';
import { voiceDeliveryRecordSchema } from '../contracts/voice.js';
import { attemptRecordSchema } from '../contracts/attempt.js';
import { accountingRecordSchema } from '../contracts/metadata.js';
import { messageRecordSchema } from '../contracts/message.js';
import type { SessionRecord } from '../contracts/session.js';
import type { ExecutionLease } from '../contracts/repositories.js';
import { acceptanceSchema, bounded, graphThreadId, key } from './records.js';
import { buildReferenceManifest } from '../context/reference-selection.js';
import { buildTurnGraph } from '../agent/turn-graph.js';
import { boundaryFor } from '../agent/state.js';
import { graphConfig } from '../chat-runtime/finalization.js';
import { hashPayload } from '../platform/crypto/hash-payload.js';
import { titleFor } from '../chat-runtime/identity.js';
import { AppError } from '../platform/errors/app-error.js';
import { memoryCalendarRecordSchema, memoryCalendarStateSchema } from '../chat-runtime/memory-calendar-state.js';

export class MemoryTextArchive {
  private readonly uncertainReleases = new Map<string, ExecutionLease>();
  constructor(private readonly p: PersistenceBundle, private readonly assets: FixedAssets) {
    if (!p.owner.store || typeof p.owner.store.read !== 'function' || typeof p.owner.store.insert !== 'function')
      throw new AppError('NOT_READY', 'Terminal saving is unavailable.');
  }
  readonly saveVoiceObservation: SaveVoiceObservation = async (record, limits) => {
    const store = this.p.owner.store!;
    try {
      if (limits.maxOperations < 3 || record.status === 'pending') return 'failed';
      const id = key('voice-accounting', record.userId, record.sessionId, record.usageId);
      const expected = bounded(voiceAccountingRecordSchema, record, id,
        Math.min(limits.maxBytes, this.p.metadata.budgets.maxDocumentBytes)).record;
      await this.p.owner.assertExecutor();
      const old = await store.read('metadata', voiceAccountingRecordSchema, { _id: id, userId: record.userId, sessionId: record.sessionId });
      if (old) return isDeepStrictEqual(old, expected) ? 'saved' : 'failed';
      await store.insert('metadata', voiceAccountingRecordSchema, expected, id, Math.min(limits.maxBytes, this.p.metadata.budgets.maxDocumentBytes));
      return 'saved';
    } catch (error) {
      return error instanceof AppError && ['INVALID_REQUEST', 'STORAGE_BUDGET_EXCEEDED'].includes(error.code) ? 'failed' : 'unknown';
    }
  };
  readonly save: SaveTerminal = async (e, limits) => {
    let outcome: SaveOutcome;
    try { outcome = await this.project(e, limits); }
    catch { outcome = { kind: 'unknown', retryable: true }; }
    return this.uncertainReleases.has(e.sessionId) ? { kind: 'unknown', retryable: true } : outcome;
  };
  private async project(e: TerminalEnvelope, limits: Parameters<SaveTerminal>[1]): Promise<SaveOutcome> {
    const p = this.p, store = p.owner.store;
    let operations = 0, writeBytes = 0;
    const op = async <T>(action: () => Promise<T>): Promise<T> => {
      if (++operations > limits.maxOperations) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Save operation budget exceeded.');
      return action();
    };
    const charge = (value: unknown) => {
      writeBytes += Buffer.byteLength(JSON.stringify(value), 'utf8');
      if (writeBytes > limits.maxBytes) throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Save byte budget exceeded.');
    };
    let lease: ExecutionLease | undefined;
    try {
      if (!store || (e.request.mode === 'live') !== Boolean(e.delivery)) return { kind: 'failed', retryable: false };
      const calendar = e.calendar ? memoryCalendarStateSchema.parse(e.calendar) : undefined;
      const native = calendar ? memoryCalendarRecordSchema.parse({ schemaVersion: 1, kind: 'memory-calendar-native',
        userId: e.userId, sessionId: e.sessionId, turnId: e.request.turnId, attemptId: e.request.attemptId,
        epoch: e.epoch, version: e.version, fence: e.fence, state: calendar }) : undefined;
      if (e.request.config.instructionVersion !== this.assets.instructionVersion ||
          e.request.config.knowledgeContentHash !== this.assets.knowledgeContentHash ||
          e.request.config.graphSchemaVersion !== this.assets.graphSchemaVersion) return { kind: 'failed', retryable: false };
      const previousLease = this.uncertainReleases.get(e.sessionId);
      if (previousLease) { await p.owner.release(previousLease); this.uncertainReleases.delete(e.sessionId); }
      const scope = { userId: e.userId, sessionId: e.sessionId };
      let session = await op(() => p.sessions.get(e.userId, e.sessionId));
      if (!session) {
        if (e.previousVersion !== 0) return { kind: 'failed', retryable: false };
        const record: SessionRecord = { schemaVersion: 1, ...scope,
          title: titleFor(e.input.content, p.sessions.budgets.titleMaxChars), createdAt: e.input.createdAt,
          updatedAt: e.input.createdAt, lastActivityAt: e.input.createdAt, lifecycle: 'active',
          graphThreadId: graphThreadId(e.userId, e.sessionId), latestTurnId: null,
          execution: { ownerId: null, leaseExpiresAt: null, activeAttemptId: null, generation: 0 },
          memoryPublication: { version: 0, sequence: 0, epoch: e.epoch, fence: e.fence } };
        charge(record); session = await op(() => p.sessions.createIfAbsent(record));
      }
      if (session.lifecycle !== 'active' || session.execution.activeAttemptId !== null)
        return { kind: 'failed', retryable: false };
      const published = session.memoryPublication;
      if (published && published.version < e.previousVersion) return { kind: 'failed', retryable: false };
      const acquired = await op(() => p.owner.acquire({ ...scope, ownerId: p.owner.executorId, leaseMs: 180_000 }));
      if (!acquired.ok) return { kind: 'failed', retryable: true };
      lease = acquired.lease;
      const owned = lease;
      const attempt = attemptRecordSchema.parse({ schemaVersion: 1, kind: 'attempt', ...scope,
        turnId: e.request.turnId, attemptId: e.request.attemptId, idempotencyKey: e.request.requestKey,
        payloadHash: hashPayload(e.input.content), calendarReplyTo: e.request.calendarReplyTo,
        ...(native ? { nativePublication: { epoch: native.epoch, version: native.version, fence: native.fence,
          contentHash: hashPayload(JSON.stringify(native.state)) } } : {}),
        status: e.status, sequence: e.request.sequence + 2, createdAt: e.request.createdAt,
        updatedAt: e.accounting?.endedAt ?? e.request.createdAt,
        instructionVersion: e.request.config.instructionVersion, knowledgeContentHash: e.request.config.knowledgeContentHash,
        graphSchemaVersion: e.request.config.graphSchemaVersion, contextVersion: e.previousVersion,
        modelId: e.request.config.modelId, openRouterUser: e.userId, generationId: e.accounting?.generationId ?? null,
        truncated: e.status === 'truncated', errorCode: e.status === 'cancelled' ? 'CANCELLED'
          : e.status === 'interrupted' ? 'INTERRUPTED' : e.status === 'failed' ? 'PROVIDER_ERROR' : null,
        causal: { userMessageId: e.input.messageId, previousAttemptId: e.request.retryOf?.previousAttemptId ?? null } });
      const marker = acceptanceSchema.parse({ schemaVersion: 1, kind: 'acceptance', ...scope,
        turnId: attempt.turnId, attemptId: attempt.attemptId, userMessageId: e.input.messageId, payloadHash: attempt.payloadHash });
      let input = e.input;
      if (e.request.retryOf) {
        const existing = await op(() => p.messages.get(e.userId, e.sessionId, e.input.messageId));
        if (!existing || existing.role !== 'user' || existing.turnId !== input.turnId || existing.content !== input.content ||
            existing.eventId !== input.eventId || existing.sequence !== e.request.retryOf.sequence)
          return { kind: 'failed', retryable: false };
        input = existing;
      }
      const values: unknown[] = [input, e.output, attempt, marker, ...(e.accounting ? [e.accounting] : []),
        ...(e.delivery ? [e.delivery] : []), ...(native ? [native] : [])];
      values.forEach(charge);
      const ensure = async <T extends Document>(collection: string, schema: ZodType<T, ZodTypeDef, unknown>,
        value: T, id: string, maxBytes: number) => {
        const expected = bounded(schema, value, id, maxBytes).record;
        const existing = await op(() => store.read(collection, schema, { _id: id, ...scope }));
        if (existing) {
          if (!isDeepStrictEqual(existing, expected)) throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Saved payload differs.');
          return;
        }
        await op(() => p.owner.run(owned, () => store.insert(collection, schema, expected, id, maxBytes)));
      };
      // All dependencies are absolute immutable terminal records; no old lifecycle
      // transition is replayed and a retry compares the exact stored payload.
      await ensure('messages', messageRecordSchema, input,
        key('message', e.userId, e.sessionId, input.messageId), p.messages.budgets.maxMessageBytes);
      await ensure('messages', messageRecordSchema, e.output,
        key('message', e.userId, e.sessionId, e.output.messageId), p.messages.budgets.maxMessageBytes);
      await ensure('metadata', attemptRecordSchema, attempt,
        key('attempt', e.userId, e.sessionId, attempt.idempotencyKey), p.metadata.budgets.maxDocumentBytes);
      if (e.accounting) await ensure('metadata', accountingRecordSchema, e.accounting,
        key('accounting', e.userId, e.sessionId, attempt.attemptId), p.metadata.budgets.maxDocumentBytes);
      await ensure('metadata', acceptanceSchema, marker,
        key('acceptance', e.userId, e.sessionId, attempt.attemptId), p.metadata.budgets.maxDocumentBytes);
      if (e.delivery) await ensure('metadata', voiceDeliveryRecordSchema, e.delivery,
        key('voice-delivery', e.userId, e.sessionId, attempt.attemptId), p.metadata.budgets.maxDocumentBytes);
      if (native) await ensure('metadata', memoryCalendarRecordSchema, native,
        key('memory-calendar-native', e.userId, e.sessionId, attempt.attemptId), p.metadata.budgets.maxDocumentBytes);
      // Advance ordering absolutely so later legacy/live allocations cannot reuse
      // these sequences. No non-idempotent increment is retried.
      const counter = { schemaVersion: 1, kind: 'sequence-counter', ...scope, next: e.request.sequence + 3 };
      charge(counter);
      await op(() => p.owner.run(owned, async () => {
        const { next, ...base } = counter;
        await store.collection('metadata').updateOne({ _id: key('sequence-counter', e.userId, e.sessionId), ...scope },
          { $setOnInsert: { ...base, _revision: 0 }, $max: { next } }, { upsert: true, ...store.options() });
      }));
      const prior = await op(() => p.memory.get(e.userId, e.sessionId));
      if (prior && prior.contextVersion !== e.previousVersion && prior.contextVersion !== e.version)
        return { kind: 'failed', retryable: false };
      const old = prior ? await op(() => p.messages.getReferences(e.userId, e.sessionId, prior.messageRefs)) : [];
      if (prior && old.length !== prior.messageRefs.length) return { kind: 'failed', retryable: false };
      const records = new Map(old.map(r => [r.messageId, r])); records.set(input.messageId, input); records.set(e.output.messageId, e.output);
      const target = buildReferenceManifest(e.userId, e.sessionId, e.version, [...records.values()], this.assets, p.memory.budgets);
      charge(target);
      if (prior?.contextVersion === e.version && !isDeepStrictEqual(prior, target)) return { kind: 'failed', retryable: false };
      await op(() => p.owner.run(owned, () => p.memory.put(target)));
      // This background-only boundary makes final application history readable by
      // the unchanged durable voice/Calendar graph. It never generates an answer.
      const graph = buildTurnGraph((await op(() => p.checkpoints.create())).bind(owned), {
        prepare: async () => { throw new Error('Save-only graph'); }, generate: async () => { throw new Error('Save-only graph'); } });
      await op(() => graph.updateState(graphConfig(e.userId, e.sessionId), { input: null, result: null,
        sealed: false, rebase: null, calendarCursor: null, calendarSeal: null, calendarRefs: null,
        boundary: boundaryFor(target) }, 'seal'));
      // A tombstone or another generation prevents publication. Update only the
      // fields this writer owns; preserve rename/pin and monotonic activity.
      const publication = { version: e.version, sequence: e.request.sequence + 2, epoch: e.epoch, fence: e.fence };
      charge(publication);
      const result = await op(() => p.owner.run(owned, () => store.collection('sessions').updateOne({
        _id: key('session', e.userId, e.sessionId), ...scope, lifecycle: 'active',
        'execution.ownerId': owned.ownerId, 'execution.generation': owned.generation,
        ...(published ? { 'memoryPublication.version': published.version } : { memoryPublication: { $exists: false } }),
      }, { $set: { memoryPublication: publication, latestTurnId: e.request.turnId },
        $max: { updatedAt: e.output.createdAt, lastActivityAt: e.output.createdAt }, $inc: { _revision: 1 } }, store.options())));
      if (!result.acknowledged || result.matchedCount !== 1) return { kind: 'unknown', retryable: true };
      // This is a qualified save acknowledgement, not a ConfirmedRecord minted
      // from volatile state. The raw adapter promise includes ownership release.
      return { kind: 'saved', epoch: e.epoch, sessionId: e.sessionId, version: e.version, fence: e.fence };
    } catch (error) {
      return error instanceof AppError && ['INVALID_REQUEST', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'STORAGE_BUDGET_EXCEEDED'].includes(error.code)
        ? { kind: 'failed', retryable: false } : { kind: 'unknown', retryable: true };
    } finally {
      if (lease) {
        try { await p.owner.release(lease); this.uncertainReleases.delete(e.sessionId); }
        catch {
          this.uncertainReleases.set(e.sessionId, lease);
        }
      }
    }
  }
}
