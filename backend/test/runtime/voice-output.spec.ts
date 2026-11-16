/**
 * ============================================================================
 * FILE: voice-output.spec.ts
 * LOCATION: backend/test/runtime/voice-output.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Verify safe live text cadence and durable speech batching without services.
 * ROLE IN PROJECT:
 *    Exercises DurableChatRuntime's live delta/finish/settle path with real prose
 *    filtering and delivery tracking plus a deliberately slow evidence writer.
 * KEY COMPONENTS:
 *    - Controlled SSE fixture and exact durable-before-Speak trace.
 * ============================================================================
 */
import { afterEach, expect, it, vi } from 'vitest';
import { textConfigFixture } from './text-config-fixture.js';
import { textSnapshot } from '../model/config-snapshot.js';
import { chunk, usage as modelUsage, done } from '../fixtures/openrouter/frames.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { VoiceDelivery } from '../../src/voice/agent/voice-delivery.js';
import type { VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import type { LiveExecution } from '../../src/chat-runtime/ports.js';
import type { CanvasArtifactProjection } from '../../src/contracts/voice-wire.js';
import { key } from '../../src/persistence/records.js';
import { checkedResult, graphConfig } from '../../src/chat-runtime/finalization.js';
import { AppError } from '../../src/platform/errors/app-error.js';

afterEach(() => vi.useRealTimers());

it.each([
  ['application', new AppError('PERSISTENCE_ERROR', 'private storage details')],
  ['type', new TypeError('private implementation details')],
  ['validation', Object.assign(new Error('private validation payload'), { name: 'ZodError' })],
  ['unexpected', new Error('private error details')],
])('identifies %s voice runtime failures without logging exception details', async (failureKind, failure) => {
  const diagnostics: Readonly<Record<string, unknown>>[] = [];
  const h = textConfigFixture(textSnapshot(1), d => ({ ...d,
    diagnostics: { emit: fields => { diagnostics.push(fields); }, run: (_scope, work) => work() } }));
  const reservation = await h.runtime.reservations.acquire({ identity: h.identity,
    conversationId: 'voice-failure-fixture', owner: { kind: 'live', voiceSessionId: 'v-failure' } });
  try {
    const ids = await h.runtime.submitLiveTurn({ identity: h.identity,
      sessionId: 'voice-failure-fixture', reservation, configSnapshot: textSnapshot(1),
      content: 'Please answer.', idempotencyKey: 'voice-failure-key' });
    await expect(h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => undefined,
      live: { reservation, start: async () => undefined, delta: async () => { throw failure; },
        finish: async () => undefined, settle: async () => undefined } })).rejects.toBeDefined();
    expect(diagnostics).toContainEqual(expect.objectContaining({ stage: 'runtime-error', failureKind }));
    expect(JSON.stringify(diagnostics)).not.toContain('private');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  } finally { await h.dispose(); }
});

it('delivers split safe live text before model completion despite 25ms evidence writes', async () => {
  vi.useFakeTimers();
  const h = textConfigFixture(textSnapshot(1)), encoder = new TextEncoder();
  let resolveFetched!: () => void;
  const fetched = new Promise<void>(resolve => { resolveFetched = resolve; });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  h.fetcher.mockImplementationOnce(async () => {
    resolveFetched(); return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const records: VoiceDeliveryRecord[] = [], spoken: string[] = [];
  const trace: Array<{ stage: string; at: number }> = [];
  h.p.metadata.putVoiceDelivery = async r => { records.push(structuredClone(r)); };
  h.p.metadata.compareVoiceDelivery = async (r, expected) => {
    expect(records.at(-1)?.sequence).toBe(expected);
    trace.push({ stage: 'write-start', at: Date.now() });
    await new Promise<void>(resolve => setTimeout(resolve, 25));
    records.push(structuredClone(r));
    trace.push({ stage: 'write-end', at: Date.now() });
    return true;
  };
  const reservation = await h.runtime.reservations.acquire({ identity: h.identity,
    conversationId: 'voice-output-fixture', owner: { kind: 'live', voiceSessionId: 'v-output' } });
  let delivery!: VoiceDelivery;
  const flush = vi.fn(async () => undefined);
  const live: LiveExecution = {
    reservation,
    start: async (a, write) => {
      const seed = { ...deliveryFixture(), userId: a.userId, sessionId: a.sessionId, voiceSessionId: 'v-output',
        responseId: key('voice-response', a.userId, a.sessionId, a.attemptId),
        turnId: a.turnId, attemptId: a.attemptId, status: 'pending' as const,
        textGenerated: '', textSpoken: null, textRemaining: null,
        audioDurationMs: null, audioPlayedMs: null, playedSamples: null };
      delivery = new VoiceDelivery(seed, 0, write, { flush, speak: async c => {
        spoken.push(c.text);
        trace.push({ stage: 'speak', at: Date.now() });
      } }, 2000);
      await delivery.start();
    },
    delta: text => delivery.delta(text), finish: () => delivery.finish(),
    settle: async text => {
      const ref = records.at(-1)!;
      await delivery.event({ type: 'speech-completed', turnId: ref.turnId,
        responseId: ref.responseId, speechId: 'speech-output', audioDurationMs: 100,
        audioSamples: 2400, usage: { providerRequestId: null, model: 'fixture',
          modelVersion: null, audioMs: 100, billableCharacters: text.length } });
      await delivery.playback(2400); await delivery.settle(text);
    },
  };
  let running: Promise<void> | undefined;
  try {
    const ids = await h.runtime.submitLiveTurn({ identity: h.identity,
      sessionId: 'voice-output-fixture', reservation, configSnapshot: textSnapshot(1),
      content: 'Please answer.', idempotencyKey: 'voice-output-key' });
    running = h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => undefined, live });
    running.catch(() => undefined);
    await fetched;
    controller.enqueue(encoder.encode(chunk('<thi')));
    controller.enqueue(encoder.encode(chunk('nk>private hidden reasoning.</think>Keep every word in orde')));
    await vi.advanceTimersByTimeAsync(0);
    expect(spoken).toEqual([]);
    controller.enqueue(encoder.encode(chunk('r ')));
    await vi.advanceTimersByTimeAsync(25);
    expect(spoken.join('')).toBe('Keep every word in order');
    expect(flush).not.toHaveBeenCalled(); // Provider has not completed the model response.
    controller.enqueue(encoder.encode(chunk('and preserve demo_id exactly ₹12.50')));
    await vi.advanceTimersByTimeAsync(0);
    expect(spoken.join('')).toBe('Keep every word in order and preserve demo_id exactly');
    controller.enqueue(encoder.encode(chunk('', 'stop') + modelUsage + done));
    controller.close();
    await vi.advanceTimersByTimeAsync(250);
    await running;
    expect(flush).toHaveBeenCalledTimes(1);
    expect(records.at(-1)).toMatchObject({ status: 'completed',
      textSpoken: 'Keep every word in order and preserve demo_id exactly ₹12.50' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(trace.find(t => t.stage === 'speak')!.at)
      .toBeLessThanOrEqual(trace.find(t => t.stage === 'write-end')!.at);
  } finally {
    if (running) {
      await vi.advanceTimersByTimeAsync(30000);
      await running.catch(() => undefined);
    }
    await h.dispose();
  }
});

it('captures complete visual suffixes, seals clean speech, and persists durable projections', async () => {
  vi.useFakeTimers();
  const h = textConfigFixture(textSnapshot(1)), encoder = new TextEncoder();
  let resolveFetched!: () => void;
  const fetched = new Promise<void>(resolve => { resolveFetched = resolve; });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  h.fetcher.mockImplementationOnce(async () => {
    resolveFetched(); return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const records: VoiceDeliveryRecord[] = [], spoken: string[] = [];
  const artifacts: CanvasArtifactProjection[] = [];
  const origPut = h.p.metadata.putVoiceDelivery.bind(h.p.metadata);
  const origCompare = h.p.metadata.compareVoiceDelivery.bind(h.p.metadata);
  h.p.metadata.putVoiceDelivery = async r => { records.push(structuredClone(r)); await origPut(r); };
  h.p.metadata.compareVoiceDelivery = async (r, expected) => {
    expect(records.at(-1)?.sequence).toBe(expected);
    records.push(structuredClone(r));
    return origCompare(r, expected);
  };
  const reservation = await h.runtime.reservations.acquire({ identity: h.identity,
    conversationId: 'voice-visual-fixture', owner: { kind: 'live', voiceSessionId: 'v-visual' } });
  let delivery!: VoiceDelivery;
  const flush = vi.fn(async () => undefined);
  let expectedResponseId!: string;
  const live: LiveExecution = {
    reservation,
    start: async (a, write) => {
      expectedResponseId = key('voice-response', a.userId, a.sessionId, a.attemptId);
      const seed = { ...deliveryFixture(), userId: a.userId, sessionId: a.sessionId, voiceSessionId: 'v-visual',
        turnId: a.turnId, attemptId: a.attemptId, responseId: expectedResponseId, status: 'pending' as const,
        textGenerated: '', textSpoken: null, textRemaining: null,
        audioDurationMs: null, audioPlayedMs: null, playedSamples: null };
      delivery = new VoiceDelivery(seed, 0, write, { flush, speak: async c => {
        spoken.push(c.text);
      } }, 2000);
      await delivery.start();
    },
    delta: text => delivery.delta(text),
    artifact: async artifact => {
      const persisted = await delivery.artifact(artifact);
      if (persisted) {
        artifacts.push(artifact);
        const stored = await h.p.metadata.getVoiceDelivery(h.identity.userId, 'voice-visual-fixture', records[0]?.attemptId ?? '');
        if (stored?.canvasArtifacts) {
          expect(stored.canvasArtifacts).toContainEqual(artifact);
        }
      }
      return persisted;
    },
    finish: () => delivery.finish(),
    settle: async text => {
      const ref = records.at(-1)!;
      await delivery.event({ type: 'speech-completed', turnId: ref.turnId,
        responseId: ref.responseId, speechId: 'speech-visual', audioDurationMs: 100,
        audioSamples: 2400, usage: { providerRequestId: null, model: 'fixture',
          modelVersion: null, audioMs: 100, billableCharacters: text.length } });
      await delivery.playback(2400); await delivery.settle(text);
    },
  };
  let running: Promise<void> | undefined;
  try {
    const ids = await h.runtime.submitLiveTurn({ identity: h.identity,
      sessionId: 'voice-visual-fixture', reservation, configSnapshot: textSnapshot(1),
      content: 'Please explain the approval path.', idempotencyKey: 'voice-visual-key' });
    running = h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => undefined, live });
    running.catch(() => undefined);
    await fetched;
    controller.enqueue(encoder.encode(chunk('Explain the concept. Follow A to B.\n')));
    controller.enqueue(encoder.encode(chunk('```mermaid title="Approval path"\nflowchart TD\nA --> B\n```\n')));
    await vi.advanceTimersByTimeAsync(100);
    expect(artifacts).toHaveLength(1);
    expect(flush).toHaveBeenCalledTimes(1); // Speech closed at visual start, not provider EOF.
    expect(spoken.join('')).toBe('Explain the concept. Follow A to B.');
    controller.enqueue(encoder.encode(chunk('Trailing model commentary must remain silent.')));
    controller.enqueue(encoder.encode(chunk('', 'stop') + modelUsage + done));
    controller.close();
    await vi.advanceTimersByTimeAsync(250);
    await running;
    const assistant = (await h.p.messages.listForContext(h.identity.userId, ids.sessionId,
      { cursor: null, limit: 50 })).items.find(message => message.role === 'assistant')!;
    expect(assistant.content).toBe(spoken.join(''));
    expect(assistant.canvasArtifacts).toEqual(artifacts);
    expect(assistant.canvasArtifacts?.[0].responseId).toBe(
      key('voice-response', h.identity.userId, ids.sessionId, ids.attemptId));
    expect(h.fetcher).toHaveBeenCalledTimes(1);

    const graphHandle = await h.runtime.graph({ userId: h.identity.userId, sessionId: ids.sessionId,
      ownerId: 'test-executor', leaseExpiresAt: new Date(Date.now() + 60000).toISOString() });
    const graphState = await graphHandle.getState(graphConfig(h.identity.userId, ids.sessionId));
    const result = graphState.values.result;
    expect(result.assistant.canvasArtifacts).toEqual(artifacts);
    expect(result.assistant.content).not.toContain('flowchart');

    const attemptRec = (await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId))!;
    await expect(checkedResult(h.p, attemptRec, result)).resolves.toBeDefined();
    const tampered = { ...result, assistant: { ...result.assistant, canvasArtifacts: [] } };
    await expect(checkedResult(h.p, attemptRec, tampered)).rejects.toThrow();
  } finally {
    if (running) {
      await vi.advanceTimersByTimeAsync(30000);
      await running.catch(() => undefined);
    }
    await h.dispose();
  }
});

it('fails closed when visual delivery hook is absent for an accepted visual', async () => {
  vi.useFakeTimers();
  const h = textConfigFixture(textSnapshot(1)), encoder = new TextEncoder();
  let resolveFetched!: () => void;
  const fetched = new Promise<void>(resolve => { resolveFetched = resolve; });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  h.fetcher.mockImplementationOnce(async () => {
    resolveFetched(); return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const reservation = await h.runtime.reservations.acquire({ identity: h.identity,
    conversationId: 'voice-no-hook-fixture', owner: { kind: 'live', voiceSessionId: 'v-no-hook' } });
  const live: LiveExecution = {
    reservation,
    start: async () => undefined,
    delta: async () => undefined,
    finish: async () => undefined,
    settle: async () => undefined,
  };
  let running: Promise<void> | undefined;
  try {
    const ids = await h.runtime.submitLiveTurn({ identity: h.identity,
      sessionId: 'voice-no-hook-fixture', reservation, configSnapshot: textSnapshot(1),
      content: 'Please explain.', idempotencyKey: 'voice-no-hook-key' });
    running = h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => undefined, live });
    running.catch(() => undefined);
    await fetched;
    controller.enqueue(encoder.encode(chunk('```mermaid title="Approval path"\nflowchart TD\nA --> B\n```\n')));
    await expect(running).rejects.toThrow('Visual delivery is unavailable.');
  } finally {
    try { controller?.close(); } catch { /* ignore */ }
    if (running) {
      await vi.advanceTimersByTimeAsync(30000);
      await running.catch(() => undefined);
    }
    await h.dispose();
  }
});

it('retains confirmed journal artifacts through crash and double reconciliation without reinference', async () => {
  vi.useFakeTimers();
  const h = textConfigFixture(textSnapshot(1)), encoder = new TextEncoder();
  let resolveFetched!: () => void;
  const fetched = new Promise<void>(resolve => { resolveFetched = resolve; });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  h.fetcher.mockImplementationOnce(async () => {
    resolveFetched(); return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const records: VoiceDeliveryRecord[] = [];
  const origPut = h.p.metadata.putVoiceDelivery.bind(h.p.metadata);
  const origCompare = h.p.metadata.compareVoiceDelivery.bind(h.p.metadata);
  h.p.metadata.putVoiceDelivery = async r => { records.push(structuredClone(r)); await origPut(r); };
  h.p.metadata.compareVoiceDelivery = async (r, expected) => {
    records.push(structuredClone(r));
    return origCompare(r, expected);
  };
  const reservation = await h.runtime.reservations.acquire({ identity: h.identity,
    conversationId: 'voice-recovery-fixture', owner: { kind: 'live', voiceSessionId: 'v-recovery' } });
  let delivery!: VoiceDelivery;
  let completeArtifact: CanvasArtifactProjection | undefined;
  const live: LiveExecution = {
    reservation,
    start: async (a, write) => {
      const responseId = key('voice-response', a.userId, a.sessionId, a.attemptId);
      const seed = { ...deliveryFixture(), userId: a.userId, sessionId: a.sessionId, voiceSessionId: 'v-recovery',
        turnId: a.turnId, attemptId: a.attemptId, responseId, status: 'pending' as const,
        textGenerated: '', textSpoken: null, textRemaining: null,
        audioDurationMs: null, audioPlayedMs: null, playedSamples: null };
      delivery = new VoiceDelivery(seed, 0, write, { flush: async () => undefined, speak: async () => undefined }, 2000);
      await delivery.start();
    },
    delta: text => delivery.delta(text),
    artifact: async artifact => {
      const ok = await delivery.artifact(artifact);
      if (ok && !completeArtifact) completeArtifact = structuredClone(artifact);
      return ok;
    },
    finish: () => delivery.finish(),
    settle: async text => { await delivery.settle(text); },
  };
  let ids!: { sessionId: string; turnId: string; attemptId: string };
  let running: Promise<void> | undefined;
  try {
    ids = await h.runtime.submitLiveTurn({ identity: h.identity,
      sessionId: 'voice-recovery-fixture', reservation, configSnapshot: textSnapshot(1),
      content: 'Please explain the approval path.', idempotencyKey: 'voice-recovery-key' });
    running = h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
      signal: new AbortController().signal, emit: async () => undefined, live });
    running.catch(() => undefined);
    await fetched;
    controller.enqueue(encoder.encode(chunk('Explain the concept.\n')));
    controller.enqueue(encoder.encode(chunk('```mermaid title="Approval path"\nflowchart TD\nA --> B\n```\n')));
    await vi.advanceTimersByTimeAsync(100);
    expect(completeArtifact).toBeDefined();
    controller.enqueue(encoder.encode(chunk('```chart\n{"type":"bar"')));
    await vi.advanceTimersByTimeAsync(50);

    controller.error(new Error('process crashed'));
    await vi.advanceTimersByTimeAsync(30000);
    await running.catch(() => undefined);
    await h.restart();
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    const recovered = (await h.p.messages.listForContext(h.identity.userId, ids.sessionId,
      { cursor: null, limit: 50 })).items.filter(message => message.role === 'assistant');
    expect(recovered).toHaveLength(1);
    expect(recovered[0].canvasArtifacts).toEqual([completeArtifact]);
    expect(recovered[0].content).not.toContain('flowchart');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    const storedDelivery = await h.p.metadata.getVoiceDelivery(h.identity.userId, ids.sessionId, ids.attemptId);
    expect(storedDelivery?.textGenerated).toBe(recovered[0].content);
    expect(storedDelivery?.canvasArtifacts).toEqual([completeArtifact]);
  } finally {
    try { controller?.close(); } catch { /* ignore */ }
    if (running) {
      await vi.advanceTimersByTimeAsync(30000);
      await running.catch(() => undefined);
    }
    await h.dispose();
  }
});
