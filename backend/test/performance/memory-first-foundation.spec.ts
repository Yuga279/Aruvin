/**
 * ============================================================================
 * FILE: memory-first-foundation.spec.ts
 * LOCATION: backend/test/performance/memory-first-foundation.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify volatile conversation authority and bounded save-only supervision.
 * ROLE IN PROJECT:
 *    Exercises Task 2 without migrating runtime, voice, repositories or providers.
 * KEY COMPONENTS:
 *    - Blocked sink: Unsaved context, ordered publication and honest drain.
 *    - Admission: Deduplication, mode exclusion, capacity and fencing.
 * ============================================================================
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryFirstFoundation, type MemoryFirstPolicy, type SaveOutcome,
  type TerminalEnvelope } from '../../src/chat-runtime/memory-first-foundation.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { assets, ports, environment } from '../context/fixtures.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { agentMemoryManifestSchema } from '../../src/contracts/agent-memory.js';

// Proposed fixture policy ONLY. No deployment budgets are selected by this task.
const policy: MemoryFirstPolicy = {
  maxSessions: 3, maxSessionBytes: 64_000, maxMemoryBytes: 192_000,
  maxRequestsPerSession: 8, maxTurnsPerSession: 8,
  maxEnvelopes: 8, maxEnvelopeBytes: 16_000, maxBacklogBytes: 128_000,
  maxInputBytes: 2_000, maxOutputBytes: 4_000, maxEvidenceBytes: 4_000,
  maxOperationsPerSave: 8,
  maxConcurrentSaves: 2, maxAttempts: 2, retryBackoffMs: 10,
  writeTimeoutMs: 50, maxDirtyAgeMs: 1_000, requestRetentionMs: 100,
  shutdownDrainMs: 20,
};
const config = { revision: 'config-1', modelId: 'fixture',
  instructionVersion: assets.instructionVersion, knowledgeContentHash: assets.knowledgeContentHash,
  graphSchemaVersion: assets.graphSchemaVersion };
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const saved = (e: TerminalEnvelope): SaveOutcome => ({ kind: 'saved', epoch: e.epoch,
  sessionId: e.sessionId, version: e.version, fence: e.fence });
function setup(overrides: Partial<MemoryFirstPolicy> = {}, sink = vi.fn(async (e: TerminalEnvelope) => saved(e))) {
  const memory = new MemoryFirstFoundation({ userId: 'u1', epoch: 'boot-1', policy: { ...policy, ...overrides }, save: sink });
  const accept = (requestKey = 'request-1', sessionId = 's1', mode: 'text' | 'live' = 'text', content = 'Hello') =>
    memory.accept({ sessionId, requestKey, mode, content, config,
      voice: mode === 'live' ? { voiceSessionId: 'voice-1', socketEpoch: 1, providerTurnId: requestKey } : null,
      calendarReplyTo: null });
  return { memory, accept, sink };
}
afterEach(() => vi.useRealTimers());

describe('memory-first foundation (offline, not runtime integration)', () => {
  it('flushes earlier terminal turns in order without duplicating a pending write', async () => {
    const first = deferred<SaveOutcome>(), second = deferred<SaveOutcome>();
    const sink = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const f = setup({}, sink), a = f.accept();
    const one = f.memory.complete(a, { content: 'First', status: 'completed' });
    const b = f.accept('request-2');
    const two = f.memory.complete(b, { content: 'Second', status: 'completed' });
    const flush = f.memory.flushSession('s1');
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(1);
    first.resolve(saved(one));
    await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(2));
    expect(f.memory.session('s1').durableVersion).toBe(1);
    second.resolve(saved(two)); await flush;
    expect(f.memory.session('s1')).toMatchObject({ version: 2, durableVersion: 2, dirty: false });
  });

  it('fails promotion flush on unresolved writes while retaining dirty ownership', async () => {
    const pending = deferred<SaveOutcome>();
    const f = setup({ writeTimeoutMs: 10 }, vi.fn(() => pending.promise));
    const turn = f.accept(), envelope = f.memory.complete(turn, { content: 'Hi', status: 'completed' });
    await expect(f.memory.flushSession('s1')).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    expect(f.memory.session('s1')).toMatchObject({ durableVersion: 0, dirty: true });
    expect(f.sink).toHaveBeenCalledTimes(1);
    pending.resolve(saved(envelope));
    await vi.waitFor(() => expect(f.memory.session('s1').durableVersion).toBe(1));
  });

  it('refuses failed or fenced session flushes without losing the pinned envelope', async () => {
    const failed = setup({}, vi.fn(async () => ({ kind: 'failed' as const, retryable: false })));
    const a = failed.accept();
    failed.memory.complete(a, { content: 'Unsaved', status: 'completed' });
    await expect(failed.memory.flushSession('s1')).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    expect(failed.memory.session('s1')).toMatchObject({ version: 1, durableVersion: 0, dirty: true });
    expect(failed.memory.snapshot().pending).toBe(1);
    expect(failed.memory.evictClean('s1')).toBe(false);
    const pending = deferred<SaveOutcome>();
    const fenced = setup({}, vi.fn(() => pending.promise)), b = fenced.accept();
    const envelope = fenced.memory.complete(b, { content: 'Fenced', status: 'completed' });
    await Promise.resolve();
    fenced.memory.fence('s1', 1, 'revoked');
    await expect(fenced.memory.flushSession('s1')).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    pending.resolve(saved(envelope));
    await vi.waitFor(() => expect(fenced.memory.snapshot().unresolvedWrites).toBe(0));
    expect(fenced.memory.session('s1')).toMatchObject({ version: 1, durableVersion: 0, fenced: true, dirty: true });
    expect(fenced.memory.snapshot().pending).toBe(1);
  });

  it.each(['completed', 'failed'] as const)('imports a %s promoted seal once without scheduling another archive write', status => {
    const f = setup(), turn = f.accept();
    const source = f.memory.context(turn);
    const input = messageRecordSchema.parse({ schemaVersion: 1, userId: turn.userId, sessionId: turn.sessionId,
      turnId: turn.turnId, attemptId: null, messageId: turn.userMessageId, eventId: turn.inputEventId,
      sequence: turn.sequence, role: 'user', content: turn.content, createdAt: turn.createdAt,
      completionStatus: 'accepted', truncated: false });
    const output = messageRecordSchema.parse({ ...input, attemptId: turn.attemptId,
      messageId: turn.outputMessageId, eventId: turn.outputEventId, sequence: turn.sequence + 1,
      role: 'assistant', content: 'Durable answer', completionStatus: status });
    const selected = status === 'completed' ? [input, output] : [input];
    const manifest = agentMemoryManifestSchema.parse({ ...source.manifest, contextVersion: 1,
      messageRefs: selected.map(({ messageId, eventId, sequence }) => ({ messageId, eventId, sequence })),
      sourceRanges: [{ fromSequence: input.sequence, toSequence: selected.at(-1)!.sequence,
        fromEventId: input.eventId, toEventId: selected.at(-1)!.eventId }] });
    expect(() => f.memory.commitPromoted(turn, { input, output, manifest: { ...manifest, contextVersion: 2 } }))
      .toThrow(/promot/i);
    const imported = f.memory.commitPromoted(turn, { input, output, manifest });
    expect(imported.output).toEqual(output);
    expect(f.memory.saveState(turn)).toBe('saved');
    expect(f.memory.session('s1')).toMatchObject({ version: 1, durableVersion: 1, activeAttemptId: null, dirty: false });
    expect(f.memory.snapshot().pending).toBe(0);
    expect(f.sink).not.toHaveBeenCalled();
    const next = f.accept('request-2');
    expect(f.memory.context(next).records.map(record => record.content)).toEqual(selected.map(record => record.content));
    expect(f.memory.history('s1').map(record => record.content)).toEqual(['Hello', 'Durable answer']);
  });

  it.each([['expiry', 'text'], ['invalidation', 'text'], ['expiry', 'live'], ['invalidation', 'live']] as const)(
    'keeps promoted Calendar narration on %s in %s context, history and replay', (mode, responseMode) => {
    vi.useFakeTimers();
    const f = setup(), turn = f.accept('request-1', 's1', responseMode), source = f.memory.context(turn);
    const input = messageRecordSchema.parse({ schemaVersion: 1, userId: turn.userId, sessionId: turn.sessionId,
      turnId: turn.turnId, attemptId: null, messageId: turn.userMessageId, eventId: turn.inputEventId,
      sequence: turn.sequence, role: 'user', content: turn.content, createdAt: turn.createdAt,
      completionStatus: 'accepted', truncated: false, mode: responseMode,
      ...(turn.voice ? { visibility: 'internal', voiceSessionId: turn.voice.voiceSessionId } : {}) });
    const output = messageRecordSchema.parse({ ...input, attemptId: turn.attemptId,
      messageId: turn.outputMessageId, eventId: turn.outputEventId, sequence: turn.sequence + 1,
      role: 'assistant', content: 'Private appointment', completionStatus: 'completed', sourceProvenance: [{
        schemaVersion: 1, sourceId: 'source-1', plugin: 'google-calendar', connectionId: 'calendar-1',
        connectionRevision: 1, operationIds: ['operation-1'], fetchedAt: turn.createdAt,
        expiresAt: new Date(Date.now() + 100).toISOString(), redactedAt: null,
        permission: { content: 'retained', minimalEvidenceAllowed: true, policyId: 'calendar-policy' },
      }] });
    const manifest = agentMemoryManifestSchema.parse({ ...source.manifest, contextVersion: 1,
      messageRefs: [input, output].map(({ messageId, eventId, sequence }) => ({ messageId, eventId, sequence })),
      sourceRanges: [{ fromSequence: input.sequence, toSequence: output.sequence,
        fromEventId: input.eventId, toEventId: output.eventId }] });
    const delivery = turn.voice ? { schemaVersion: 1 as const, kind: 'voice-delivery' as const,
      userId: 'u1', sessionId: 's1', voiceSessionId: turn.voice.voiceSessionId, turnId: turn.turnId,
      attemptId: turn.attemptId, responseId: 'response-1', eventId: 'delivery-1', sequence: 2,
      speechId: 'speech-1', providerSocketId: 'socket-1', status: 'completed' as const,
      audioDurationMs: 100, audioPlayedMs: 30, playedSamples: 480,
      textGenerated: output.content, textSpoken: 'Private', textRemaining: ' appointment',
      createdAt: turn.createdAt, updatedAt: turn.createdAt } : undefined;
    f.memory.commitPromoted(turn, { input, output, manifest, delivery });
    if (mode === 'expiry') vi.advanceTimersByTime(101);
    else f.memory.invalidateCalendarAccount({ userId: 'u1', connectionId: 'calendar-1', connectionRevision: 1, googleSubjectId: 'google-1' });
    expect(f.memory.records('s1').at(-1)?.content).toBe('Private appointment');
    expect(f.memory.history('s1').at(-1)?.content).toBe('Private appointment');
    expect(f.memory.result(turn)?.output.content).toBe('Private appointment');
    expect(f.memory.history('s1')[0]?.content).toBe('Hello');
    if (delivery) {
      expect(f.memory.deliveries('s1')[0]).toMatchObject({ textGenerated: 'Private appointment',
        textSpoken: 'Private', textRemaining: ' appointment', playedSamples: 480 });
      expect(f.memory.result(turn)?.delivery?.textGenerated).toBe('Private appointment');
      expect(delivery.textGenerated).toBe('Private appointment');
    }
  });

  it('retries a failed text turn with one accepted input and no failed assistant in model context', async () => {
    const f = setup(), first = f.accept();
    const prior = f.memory.complete(first, { content: 'Failed provisional answer', status: 'failed' });
    const retry = f.memory.accept({ sessionId: first.sessionId, requestKey: 'retry-request', content: first.content,
      mode: 'text', voice: null, calendarReplyTo: null, config: first.config,
      retryOf: { turnId: first.turnId, userMessageId: first.userMessageId, inputEventId: first.inputEventId,
        sequence: first.sequence, createdAt: first.createdAt, previousAttemptId: first.attemptId } });
    const source = f.memory.context(retry);
    expect(source.records).toEqual([prior.input]);
    const result = await new ReferencedContextAssembler(ports([])).assemble({ userId: retry.userId,
      sessionId: retry.sessionId, turnId: retry.turnId, newUserInput: retry.content, responseMode: 'text' }, source);
    expect(result.ok && result.context.messages.filter(message => message.role !== 'system'))
      .toEqual([{ role: 'user', content: 'Hello' }]);
    expect(f.memory.history('s1').at(-1)?.content).toBe('Failed provisional answer');
  });

  it('uses the first unsaved terminal answer exactly once in the next eligible context', async () => {
    const pending = deferred<SaveOutcome>();
    const f = setup({}, vi.fn(() => pending.promise));
    const first = f.accept();
    const envelope = f.memory.complete(first, { content: 'Hi', status: 'completed' });
    expect(f.memory.session('s1')).toMatchObject({ version: 1, durableVersion: 0, dirty: true });
    const second = f.accept('request-2', 's1', 'text', 'What next?');
    const source = f.memory.context(second);
    const dependencies = ports([]);
    const result = await new ReferencedContextAssembler(dependencies).assemble({
      userId: 'u1', sessionId: 's1', turnId: second.turnId, newUserInput: second.content,
      responseMode: 'text', environment,
    }, source);
    expect(result.ok && result.context.messages.filter(m => m.role !== 'system')).toEqual([
      { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'What next?' },
    ]);
    expect(dependencies.memory.get).not.toHaveBeenCalled();
    expect(dependencies.messages.get).not.toHaveBeenCalled();
    expect(f.memory.session('s1').durableVersion).toBe(0);
    f.memory.complete(second, { content: 'Next', status: 'completed' });
    pending.resolve(saved(envelope));
    await Promise.resolve();
  });

  it('joins a retained same-key request and rejects changed payload before and after completion', () => {
    const f = setup(); const first = f.accept();
    expect(f.accept()).toBe(first);
    expect(() => f.accept('request-1', 's1', 'text', 'changed')).toThrow(/payload/i);
    f.memory.complete(first, { content: 'Hi', status: 'completed' });
    expect(f.accept()).toBe(first);
    expect(f.memory.result(first)?.output.content).toBe('Hi');
    expect(() => f.accept('request-1', 's1', 'live')).toThrow(/payload/i);
  });

  it('has one synchronous text/live slot, and rejects forged or stale completion handles', () => {
    const f = setup(); const first = f.accept();
    expect(() => f.accept('request-2', 's1', 'live')).toThrow(/active/i);
    expect(() => f.memory.complete({ ...first }, { content: 'fake', status: 'completed' })).toThrow();
    f.memory.complete(first, { content: 'Hi', status: 'completed' });
    const second = f.accept('request-2', 's1', 'live');
    expect(() => f.memory.complete(first, { content: 'old', status: 'completed' })).toThrow();
    expect(f.memory.session('s1').activeAttemptId).toBe(second.attemptId);
  });

  it.each(['interrupted', 'unknown'] as const)('keeps generated voice distinct from %s heard context and holds eligibility until terminal delivery', async deliveryStatus => {
    const f = setup(); const first = f.accept('request-1', 's1', 'live');
    expect(() => f.memory.complete(first, { content: 'Hi there', status: 'completed' })).toThrow(/delivery/i);
    const delivery = { schemaVersion: 1 as const, kind: 'voice-delivery' as const,
      userId: 'u1', sessionId: 's1', voiceSessionId: 'voice-1', turnId: first.turnId,
      attemptId: first.attemptId, responseId: 'response-1', eventId: 'delivery-1', sequence: 2,
      speechId: 'speech-1', providerSocketId: 'socket-1', status: deliveryStatus,
      audioDurationMs: 100, audioPlayedMs: 30, playedSamples: 480,
      textGenerated: 'Hi there', textSpoken: deliveryStatus === 'unknown' ? null : 'Hi',
      textRemaining: deliveryStatus === 'unknown' ? null : ' there',
      createdAt: first.createdAt, updatedAt: first.createdAt };
    f.memory.complete(first, { content: 'Hi there', status: 'completed', delivery });
    const next = f.accept('request-2'); const dependencies = ports([]);
    const deliveries = f.memory.deliveries('s1');
    const assembler = new ReferencedContextAssembler({ ...dependencies, metadata: {
      getVoiceDelivery: async () => deliveries[0], getVoiceDeliveries: async () => [...deliveries],
    } });
    const r = await assembler.assemble({ userId: 'u1', sessionId: 's1', turnId: next.turnId,
      newUserInput: next.content, responseMode: 'text' }, f.memory.context(next));
    expect(r.ok && r.context.messages.filter(m => m.role === 'assistant')).toEqual([{ role: 'assistant',
      content: deliveryStatus === 'unknown' ? 'Voice reply delivery is unknown; do not assume generated content was heard.' : 'Hi' }]);
    expect(f.memory.result(first)?.output.content).toBe('Hi there');
  });

  it.each([
    { maxSessions: 1 }, { maxMemoryBytes: policy.maxSessionBytes },
    { maxEnvelopes: 1 }, { maxBacklogBytes: policy.maxEnvelopeBytes },
  ])('reserves count and bytes before work and never evicts dirty state: %j', limits => {
    const f = setup(limits, vi.fn(() => new Promise<SaveOutcome>(() => {})));
    const first = f.accept(); f.memory.complete(first, { content: 'Hi', status: 'completed' });
    expect(() => f.accept('request-2', 's2')).toThrow(/capacity/i);
    expect(f.memory.evictClean('s1')).toBe(false);
    expect(f.memory.result(first)?.output.content).toBe('Hi');
  });

  it('bounds retained request/turn counts and validates all policies', () => {
    const f = setup({ maxRequestsPerSession: 1, maxTurnsPerSession: 1 });
    const a = f.accept(); f.memory.complete(a, { content: 'Hi', status: 'completed' });
    expect(() => f.accept('request-2')).toThrow(/capacity/i);
    expect(() => setup({ maxAttempts: 0 })).toThrow(/policy/i);
    expect(() => setup({ maxEnvelopeBytes: Number.NaN })).toThrow(/policy/i);
    expect(() => setup({ maxConcurrentSaves: 1.5 })).toThrow(/policy/i);
  });

  it('retains reservation after oversized terminal rejection so a bounded failure can settle', () => {
    const f = setup({ maxEnvelopeBytes: 4000, maxOutputBytes: 500, maxEvidenceBytes: 500 }); const a = f.accept();
    expect(() => f.memory.complete(a, { content: 'x'.repeat(5000), status: 'completed' })).toThrow(/capacity/i);
    expect(() => f.accept('request-2')).toThrow(/active/i);
    f.memory.complete(a, { content: '', status: 'failed' });
    expect(f.memory.result(a)?.status).toBe('failed');
  });

  it('serializes one session while independent sessions save up to the concurrency cap', async () => {
    const pending = deferred<SaveOutcome>();
    const sink = vi.fn((e: TerminalEnvelope) => e.sessionId === 's1' && e.version === 1 ? pending.promise : Promise.resolve(saved(e)));
    const f = setup({}, sink);
    const one = f.memory.complete(f.accept(), { content: 'one', status: 'completed' });
    f.memory.complete(f.accept('request-2'), { content: 'two', status: 'completed' });
    f.memory.complete(f.accept('request-3', 's2'), { content: 'other', status: 'completed' });
    await vi.waitFor(() => expect(f.memory.session('s2').durableVersion).toBe(1));
    expect(sink.mock.calls.map(([e]) => [e.sessionId, e.version])).toEqual([['s1', 1], ['s2', 1]]);
    pending.resolve(saved(one));
    expect((await f.memory.drain()).drained).toBe(true);
    expect(f.memory.session('s1').durableVersion).toBe(2);
  });

  it.each(['partial', 'unknown', 'failed'] as const)('does not mark %s publication saved and retries only the same immutable envelope', async kind => {
    vi.useFakeTimers();
    const sink = vi.fn(async (e: TerminalEnvelope): Promise<SaveOutcome> => sink.mock.calls.length === 1
      ? { kind, retryable: true } : saved(e));
    const f = setup({}, sink); const a = f.accept();
    const e = f.memory.complete(a, { content: 'Hi', status: 'completed' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.memory.session('s1').durableVersion).toBe(0);
    expect(f.memory.saveState(a)).toBe(kind === 'unknown' ? 'unknown' : 'failed');
    expect(f.memory.result(a)?.status).toBe('completed');
    await vi.advanceTimersByTimeAsync(10);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[1][0]).toBe(e);
    expect(Object.isFrozen(e.output)).toBe(true);
    expect(f.memory.session('s1').durableVersion).toBe(1);
  });

  it('latches permanent failure and caps automatic and explicit retry attempts', async () => {
    vi.useFakeTimers(); const sink = vi.fn(async (): Promise<SaveOutcome> => ({ kind: 'failed', retryable: true }));
    const f = setup({}, sink); const a = f.accept(); f.memory.complete(a, { content: 'Hi', status: 'completed' });
    await vi.advanceTimersByTimeAsync(100);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(f.memory.retrySave('s1')).toBe(false);
    expect(f.memory.session('s1')).toMatchObject({ dirty: true, durableVersion: 0 });
  });

  it('keeps raw promises after timeout; drain reports unresolved writes and never retries concurrently', async () => {
    vi.useFakeTimers(); const pending = deferred<SaveOutcome>();
    const f = setup({}, vi.fn(() => pending.promise)); const a = f.accept();
    const e = f.memory.complete(a, { content: 'Hi', status: 'completed' });
    await vi.advanceTimersByTimeAsync(60);
    expect(f.memory.saveState(a)).toBe('unknown');
    expect(f.memory.retrySave('s1')).toBe(false);
    const drain = f.memory.drain(); await vi.advanceTimersByTimeAsync(20);
    expect(await drain).toMatchObject({ drained: false, unresolvedWrites: 1, pending: 1 });
    expect(() => f.accept('request-2')).toThrow(/stopped/i);
    pending.resolve(saved(e)); await vi.advanceTimersByTimeAsync(0);
    expect(await f.memory.drain()).toMatchObject({ drained: true, unresolvedWrites: 0 });
  });

  it('rejects stale acknowledgements and fences queued work against archive/revocation', async () => {
    const pending = deferred<SaveOutcome>(); const f = setup({}, vi.fn(() => pending.promise));
    const e = f.memory.complete(f.accept(), { content: 'Hi', status: 'completed' });
    await Promise.resolve(); // The first save was dispatched before the authority fence.
    f.memory.complete(f.accept('request-2'), { content: 'Next', status: 'completed' });
    f.memory.fence('s1', 2, 'archived');
    pending.resolve(saved(e));
    await vi.waitFor(() => expect(f.memory.snapshot().unresolvedWrites).toBe(0));
    expect(f.memory.session('s1')).toMatchObject({ durableVersion: 0, dirty: true, fence: 1 });
    expect(f.sink).toHaveBeenCalledTimes(1);
    expect(() => f.accept('request-3')).toThrow(/fenced/i);
  });

  it('will not advance a watermark for a mismatched version receipt', async () => {
    const f = setup({}, vi.fn(async (e: TerminalEnvelope) => ({ ...saved(e), version: 99 } as SaveOutcome)));
    const a = f.accept(); f.memory.complete(a, { content: 'Hi', status: 'completed' });
    await vi.waitFor(() => expect(f.memory.saveState(a)).toBe('unknown'));
    expect(f.memory.session('s1').durableVersion).toBe(0);
  });

  it('stops new paid admission when dirty age expires without losing context or duplicate identity', async () => {
    vi.useFakeTimers(); const f = setup({}, vi.fn(() => new Promise<SaveOutcome>(() => {})));
    const a = f.accept(); f.memory.complete(a, { content: 'Hi', status: 'completed' });
    await vi.advanceTimersByTimeAsync(1001);
    expect(() => f.accept('request-2')).toThrow(/age/i);
    expect(f.accept()).toBe(a);
    expect(f.memory.result(a)?.output.content).toBe('Hi');
  });

  it('reserves enough bytes for maximum output/evidence before admitting even a tiny input', () => {
    const f = setup({ maxEnvelopeBytes: 4000 });
    expect(() => f.accept()).toThrow(/capacity/i);
    expect(f.memory.snapshot()).toMatchObject({ sessions: 0, pending: 0, active: 0 });
    expect(() => setup().accept('request-1', 's1', 'text', 'x'.repeat(2001))).toThrow(/capacity/i);
  });

  it('retains clean identities until explicit safe eviction and rejects previous process epochs', async () => {
    vi.useFakeTimers(); const f = setup(); const a = f.accept();
    f.memory.complete(a, { content: 'Hi', status: 'completed' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.memory.evictClean('s1')).toBe(false);
    await vi.advanceTimersByTimeAsync(101);
    expect(f.memory.evictClean('s1')).toBe(true);
    expect(() => f.memory.accept({ sessionId: 's1', requestKey: 'request-1', content: 'Hello', mode: 'text',
      config, voice: null, calendarReplyTo: null, expectedEpoch: 'previous-boot' })).toThrow(/restart/i);
  });

  it.each(['throw', 'malformed'] as const)('classifies %s save results as unknown without replay or unhandled rejection', async failure => {
    const f = setup({}, vi.fn(async () => {
      if (failure === 'throw') throw new Error('ambiguous command');
      return null as unknown as SaveOutcome;
    }));
    const a = f.accept(); f.memory.complete(a, { content: 'Hi', status: 'completed' });
    await vi.waitFor(() => expect(f.memory.saveState(a)).toBe('unknown'));
    expect(f.memory.retrySave('s1')).toBe(false);
    expect(f.memory.result(a)?.status).toBe('completed');
  });

  it('holds global save capacity during a raw timeout while preserving independent queued sessions', async () => {
    vi.useFakeTimers(); const pending = deferred<SaveOutcome>();
    const sink = vi.fn((e: TerminalEnvelope) => e.sessionId === 's1' ? pending.promise : Promise.resolve(saved(e)));
    const f = setup({ maxConcurrentSaves: 1 }, sink);
    const e = f.memory.complete(f.accept(), { content: 'Hi', status: 'completed' });
    f.memory.complete(f.accept('request-2', 's2'), { content: 'Other', status: 'completed' });
    await vi.advanceTimersByTimeAsync(100);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(f.memory.snapshot()).toMatchObject({ pending: 2, unresolvedWrites: 1 });
    pending.resolve(saved(e)); await vi.advanceTimersByTimeAsync(0);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(f.memory.session('s2').durableVersion).toBe(1);
  });

  it('reconciles commit-then-unknown using save-only idempotent projections, with no duplicate documents', async () => {
    vi.useFakeTimers(); const documents = new Map<string, string>(); let calls = 0;
    const sink = vi.fn(async (e: TerminalEnvelope): Promise<SaveOutcome> => {
      calls++;
      for (const record of [e.input, e.output]) {
        const encoded = JSON.stringify(record), previous = documents.get(record.messageId);
        if (previous && previous !== encoded) throw new Error('projection payload conflict');
        documents.set(record.messageId, encoded);
        if (calls === 1) return { kind: 'partial', retryable: true };
      }
      if (calls === 2) return { kind: 'unknown', retryable: true };
      return saved(e);
    });
    const f = setup({ maxAttempts: 3 }, sink); const a = f.accept();
    f.memory.complete(a, { content: 'Hi', status: 'completed' });
    await vi.advanceTimersByTimeAsync(0);
    expect(documents.size).toBe(1); expect(f.memory.session('s1').durableVersion).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(documents.size).toBe(2); expect(f.memory.saveState(a)).toBe('unknown');
    expect(f.memory.session('s1').durableVersion).toBe(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(documents.size).toBe(2); expect(f.memory.session('s1').durableVersion).toBe(1);
    expect(sink.mock.calls.every(([e]) => e === f.memory.result(a))).toBe(true);
  });

  it('enforces the drain deadline even with a fixed or stalled injected state clock', async () => {
    vi.useFakeTimers();
    const memory = new MemoryFirstFoundation({ userId: 'u1', epoch: 'boot-1', policy,
      now: () => 0, save: () => new Promise<SaveOutcome>(() => {}) });
    const a = memory.accept({ sessionId: 's1', requestKey: 'request-1', mode: 'text', content: 'Hello',
      config, voice: null, calendarReplyTo: null });
    memory.complete(a, { content: 'Hi', status: 'completed' });
    let result: { drained: boolean } | undefined;
    void memory.drain().then(r => { result = r; });
    await vi.advanceTimersByTimeAsync(25);
    expect(result?.drained).toBe(false);
  });

  it('does not dispatch work fenced before the adapter invocation microtask', async () => {
    const f = setup(); f.memory.complete(f.accept(), { content: 'Hi', status: 'completed' });
    f.memory.fence('s1', 1, 'revoked');
    await vi.waitFor(() => expect(f.memory.snapshot().unresolvedWrites).toBe(0));
    expect(f.sink).not.toHaveBeenCalled();
    expect(f.memory.session('s1')).toMatchObject({ durableVersion: 0, dirty: true });
  });
});
