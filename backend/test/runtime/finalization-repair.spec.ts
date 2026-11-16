/**
 * ============================================================================
 * FILE: finalization-repair.spec.ts
 * LOCATION: backend/test/runtime/finalization-repair.spec.ts
 * PURPOSE: Reproduce Calendar finalization failures across real BSON storage.
 * ROLE IN PROJECT: Exercises redaction, legacy records and saved-seal recovery
 *    without an application database or live provider requests.
 * KEY COMPONENTS: BSON message store, redaction round-trip, runtime recovery.
 * ============================================================================
 */
import { BSON } from 'mongodb';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { CALENDAR_TOMBSTONE } from '../../src/contracts/calendar-sources.js';
import { redactCalendarMessageContent } from '../../src/persistence/calendar-records.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { key } from '../../src/persistence/records.js';
import { calendarMemory } from '../persistence/calendar-multi-memory.js';
import { message } from '../persistence/fixtures.js';
import { source } from '../persistence/calendar-fixtures.js';
import { calendarFixture, textWire } from './calendar-runtime.fixture.js';
import { textConfigFixture } from './text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { attemptRecordSchema } from '../../src/contracts/attempt.js';
import { buildTurnGraph } from '../../src/agent/turn-graph.js';
import { graphConfig, publishResult, transitionConfirmed, type LivePublicationEvidence } from '../../src/chat-runtime/finalization.js';
import { Work } from '../../src/chat-runtime/work.js';
import type { ExecutionLease, ExecutionOwnership } from '../../src/contracts/repositories.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
import type { MessageRecord } from '../../src/contracts/message.js';

it('keeps text-only redaction valid after MongoDB BSON serialization', async () => {
  const mem = calendarMemory();
  const messages = new MongoMessages(mem.store, DEFAULT_BUDGETS);
  const redacted = redactCalendarMessageContent({
    ...message(2), role: 'assistant', completionStatus: 'streaming',
    sourceProvenance: [source()],
  }, Date.now());
  expect(redacted).not.toHaveProperty('voiceTranscripts');
  expect(messageRecordSchema.safeParse(BSON.deserialize(BSON.serialize(redacted, { ignoreUndefined: false }))).success)
    .toBe(true);
  await messages.append(redacted);
  await messages.updateCompletion('u1', 's1', 'm2', 'completed', false);
  expect(await messages.get('u1', 's1', 'm2')).toMatchObject({
    content: CALENDAR_TOMBSTONE, completionStatus: 'completed',
  });
});

it('reads and finalizes legacy redacted BSON messages containing null voice transcripts', async () => {
  const mem = calendarMemory();
  const messages = new MongoMessages(mem.store, DEFAULT_BUDGETS);
  const id = key('message', 'u1', 's1', 'm2');
  mem.rows('messages').set(id, BSON.deserialize(BSON.serialize({
    ...message(2), role: 'assistant', completionStatus: 'streaming',
    content: CALENDAR_TOMBSTONE, sourceProvenance: [source()],
    voiceTranscripts: null, _id: id, _revision: 0,
  })));
  await messages.updateCompletion('u1', 's1', 'm2', 'completed', false);
  expect(await messages.get('u1', 's1', 'm2')).toMatchObject({
    content: CALENDAR_TOMBSTONE, completionStatus: 'completed',
  });
  expect(mem.rows('messages').get(id)?.voiceTranscripts).toEqual([]);
});

it('completes Calendar publication when a text-only answer is redacted before BSON persistence', async () => {
  const h = calendarFixture();
  const mem = calendarMemory();
  const messages = new MongoMessages(mem.store, h.p.messages.budgets, h.clock);
  const append = messages.append.bind(messages);
  messages.append = record => append(record.role === 'assistant'
    ? redactCalendarMessageContent(record, h.clock()) : record);
  h.p.messages = messages;
  try {
    const ids = await h.submit('Hello');
    h.modelWires.push(textWire('Hello.'));
    await h.execute(ids);
    expect(await h.runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ status: 'completed' });
    expect((await h.p.sessions.get(h.identity.userId, ids.sessionId))?.execution)
      .toMatchObject({ ownerId: null, activeAttemptId: null });
    expect(h.modelBodies).toHaveLength(1);
  } finally { await h.dispose(); }
});

it('recovers an unfinished legacy Calendar message without replaying the model', async () => {
  const h = calendarFixture();
  const mem = calendarMemory();
  const messages = new MongoMessages(mem.store, h.p.messages.budgets, h.clock);
  const append = messages.append.bind(messages);
  messages.append = async record => {
    await append(record);
    if (record.role === 'assistant') {
      const id = key('message', record.userId, record.sessionId, record.messageId);
      const saved = mem.rows('messages').get(id)!;
      mem.rows('messages').set(id, { ...saved, content: CALENDAR_TOMBSTONE, voiceTranscripts: null });
      throw new AppError('PERSISTENCE_ERROR', 'Fixture crash after legacy archive write.');
    }
  };
  h.p.messages = messages;
  try {
    const ids = await h.submit('Hello');
    h.modelWires.push(textWire('Hello.'));
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status)
      .toBe('finalizing');
    messages.append = append;
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect(await h.runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ status: 'completed' });
    expect((await h.p.sessions.get(h.identity.userId, ids.sessionId))?.execution)
      .toMatchObject({ ownerId: null, activeAttemptId: null });
    expect(h.modelBodies).toHaveLength(1);
    expect(h.effects).toHaveLength(0);
  } finally { await h.dispose(); }
});

it('quarantines unfinished publication even when the recovery checkpoint read also fails', async () => {
  const h = textConfigFixture(textSnapshot(1));
  const put = h.p.memory.put.bind(h.p.memory);
  let readFailure: { mockRestore(): void } | undefined;
  h.p.memory.put = async manifest => {
    if (manifest.contextVersion === 1) {
      readFailure = vi.spyOn(h.saver, 'getTuple').mockRejectedValue(new Error('Fixture checkpoint read outage.'));
      throw new AppError('PERSISTENCE_ERROR', 'Fixture publication outage.');
    }
    await put(manifest);
  };
  try {
    const ids = await h.submit();
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR', message: 'Fixture publication outage.' });
    expect(h.runtime.snapshot()).toMatchObject({ active: 0, degraded: true });
    expect((await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))?.status)
      .toBe('finalizing');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { readFailure?.mockRestore(); await h.dispose(); }
});

it.each([
  ['archive-save', false], ['archive-save', true],
  ['manifest-save', false], ['manifest-save', true],
  ['terminal-cas', false], ['terminal-cas', true],
] as const)('recovers Calendar %s interruption (afterCommit=%s) without repeating inference', async (point, afterCommit) => {
  const h = calendarFixture();
  try {
    const ids = await h.submit('Hello');
    h.modelWires.push(textWire('Hello.'));
    if (point === 'terminal-cas') {
      const compare = h.p.metadata.compareAttempt.bind(h.p.metadata);
      let fail = true;
      h.p.metadata.compareAttempt = async (attempt, expected) => {
        if (fail && attempt.status === 'completed') {
          fail = false;
          if (afterCommit) await compare(attempt, expected);
          throw new AppError('PERSISTENCE_ERROR', 'Fixture terminal transition outage.');
        }
        return compare(attempt, expected);
      };
    } else h.failOnce(point, afterCommit);
    await expect(h.execute(ids)).rejects.toBeDefined();
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect(await h.runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId))
      .toMatchObject({ status: 'completed' });
    expect((await h.p.sessions.get(h.identity.userId, ids.sessionId))?.execution)
      .toMatchObject({ ownerId: null, activeAttemptId: null });
    const history = await h.p.messages.list(h.identity.userId, ids.sessionId, { cursor: null, limit: 50 });
    expect(history.items.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(h.modelBodies).toHaveLength(1);
    expect(h.effects).toHaveLength(0);
  } finally { await h.dispose(); }
});

const confirmedAttempt = () => attemptRecordSchema.parse({
  schemaVersion: 1, kind: 'attempt', userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
  idempotencyKey: 'request-0001', payloadHash: 'a'.repeat(64), status: 'accepted', sequence: 1,
  createdAt: '2026-10-21T09:00:00.000Z', updatedAt: '2026-10-21T09:00:00.000Z', instructionVersion: 'fixture-v1',
  knowledgeContentHash: 'b'.repeat(64), graphSchemaVersion: 'fixture-v1', contextVersion: 0,
  modelId: 'fixture-model', openRouterUser: 'u1', generationId: null, truncated: false, errorCode: null,
  causal: { userMessageId: 'm1', previousAttemptId: null },
});

it('advances an attempt from a confirmed receipt and refuses a stale receipt', async () => {
  const mem = calendarMemory();
  const metadata = new MongoMetadata(mem.store, DEFAULT_BUDGETS);
  const attempt = confirmedAttempt();
  await metadata.putAttempt(attempt);
  const receipt = (await metadata.getAttemptConfirmed!('u1', 's1', 'a1'))!;
  const owner = { executorId: 'current', async run<T>(_lease: ExecutionLease, action: () => Promise<T>) { return action(); } } as unknown as ExecutionOwnership;
  const p = { metadata, owner } as unknown as PersistenceBundle;
  const work = new Work(new AbortController().signal, 10000, () => {}, () => {});
  const lease: ExecutionLease = { userId: 'u1', sessionId: 's1', ownerId: 'current', generation: 1, leaseExpiresAt: '2026-10-21T10:00:00.000Z' };
  try {
    const generating = await transitionConfirmed(p, lease, work, receipt, 'generating');
    expect(generating.record.status).toBe('generating');
    expect((await metadata.getAttempt('u1', 's1', 'a1'))?.status).toBe('generating');
    await expect(transitionConfirmed(p, lease, work, receipt, 'finalizing'))
      .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  } finally { work.close(); }
});

/** Collects the durable evidence a live turn already holds before it publishes. */
async function liveEvidence(h: ReturnType<typeof textConfigFixture>, ids: { sessionId: string; attemptId: string },
  graph: ReturnType<typeof buildTurnGraph>): Promise<LivePublicationEvidence> {
  const userId = h.identity.userId;
  const attempt = (await h.p.metadata.getAttempt(userId, ids.sessionId, ids.attemptId))!;
  const acceptedInput = (await h.p.messages.get(userId, ids.sessionId, attempt.causal.userMessageId))!;
  const acceptance = (await h.p.metadata.getAcceptance(userId, ids.sessionId, ids.attemptId))!;
  const baseManifest = (await h.p.memory.get(userId, ids.sessionId))!;
  const sourceRecords = await h.p.messages.getReferences(userId, ids.sessionId, baseManifest.messageRefs);
  const confirmedSnapshot = await graph.getState(graphConfig(userId, ids.sessionId));
  return { acceptedInput, acceptance, baseManifest, sourceRecords, confirmedSnapshot,
    attemptReceipt: null, accountingReceipt: null };
}

it('publishes live evidence without re-reading the durable evidence it already holds', async () => {
  const h = textConfigFixture(textSnapshot(1));
  const work = new Work(new AbortController().signal, 10000, () => {}, () => {});
  try {
    const ids = await h.submit(); await h.execute(ids);
    const graph = buildTurnGraph(h.saver, { prepare: async () => { throw new Error('No inference'); },
      generate: async () => { throw new Error('No inference'); } });
    const snapshot = await graph.getState(graphConfig(h.identity.userId, ids.sessionId));
    const raw = snapshot.values.result!;
    const current = (await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))!;
    const lease = await h.p.owner.recoverStoppedSession(h.identity.userId, ids.sessionId, null, 180000);
    const evidence = await liveEvidence(h, ids, graph);
    const getAcceptance = vi.spyOn(h.p.metadata, 'getAcceptance');
    const getManifest = vi.spyOn(h.p.memory, 'get');
    const getReferences = vi.spyOn(h.p.messages, 'getReferences');
    const getState = vi.spyOn(graph, 'getState');
    await publishResult(h.p, lease, work, graph, current, raw, evidence);
    expect(getAcceptance).not.toHaveBeenCalled();
    expect(getManifest).not.toHaveBeenCalled();
    expect(getReferences).not.toHaveBeenCalled();
    // Only the pinned confirmation load after the graph seal remains.
    expect(getState).toHaveBeenCalledTimes(1);
  } finally { await work.settled(); work.close(); await h.dispose(); }
});

it('stages the provisional assistant append and the authoritative accounting in parallel', async () => {
  const h = textConfigFixture(textSnapshot(1));
  const work = new Work(new AbortController().signal, 10000, () => {}, () => {});
  try {
    const ids = await h.submit();
    const append = h.p.messages.append.bind(h.p.messages);
    h.p.messages.append = async () => { throw new AppError('PERSISTENCE_ERROR', 'Fixture publication interruption.'); };
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    h.p.messages.append = append;
    const graph = buildTurnGraph(h.saver, { prepare: async () => { throw new Error('No inference'); },
      generate: async () => { throw new Error('No inference'); } });
    const snapshot = await graph.getState(graphConfig(h.identity.userId, ids.sessionId));
    const raw = snapshot.values.result!;
    const current = (await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))!;
    const lease = await h.p.owner.recoverStoppedSession(h.identity.userId, ids.sessionId, null, 180000);
    const evidence = await liveEvidence(h, ids, graph);
    const order: string[] = [];
    let releaseAppend: () => void = () => undefined;
    const appendGate = new Promise<void>(resolve => { releaseAppend = resolve; });
    let reportAccounting: () => void = () => undefined;
    const accountingSeen = new Promise<void>(resolve => { reportAccounting = resolve; });
    h.p.messages.append = async (record: MessageRecord) => { order.push('append:start'); await appendGate; order.push('append:end'); await append(record); };
    const putAccounting = h.p.metadata.putAccounting.bind(h.p.metadata);
    h.p.metadata.putAccounting = async (record: any) => { order.push('accounting'); reportAccounting(); await putAccounting(record); };
    const publication = publishResult(h.p, lease, work, graph, current, raw, evidence);
    const overlapped = await Promise.race([
      accountingSeen.then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000)),
    ]);
    releaseAppend();
    await publication;
    expect(overlapped).toBe(true);
    expect(order.indexOf('accounting')).toBeLessThan(order.indexOf('append:end'));
  } finally { await work.settled(); work.close(); await h.dispose(); }
});
