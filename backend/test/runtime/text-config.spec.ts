/**
 * ============================================================================
 * FILE: text-config.spec.ts
 * LOCATION: backend/test/runtime/text-config.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test text configuration snapshot binding, execution, admission, and retries.
 *
 * ROLE IN PROJECT:
 *    Ensures DurableChatRuntime binds settings at acceptance time, executes on that
 *    binding, applies current settings to new attempts, and handles retry policies.
 *
 * KEY COMPONENTS:
 *    - Acceptance-gap tests: Retain bound settings across configuration publication.
 *    - Explicit vs automatic retries: Retry behavior and secret nonpersistence.
 * ============================================================================
 */

import { it, expect, vi, afterEach } from 'vitest';
import { textSnapshot } from '../model/config-snapshot.js';
import { textConfigFixture } from './text-config-fixture.js';
import { FRAMES } from '../fixtures/openrouter/frames.js';
import { sessionIdFor } from '../../src/chat-runtime/identity.js';
import type { ContextChatMessage } from '../../src/contracts/context.js';
import type { DeliveryWrite } from '../../src/chat-runtime/ports.js';
import { graphConfig } from '../../src/chat-runtime/finalization.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { key } from '../../src/persistence/records.js';

afterEach(() => {
  vi.useRealTimers();
});

const requestMessages = (h: ReturnType<typeof textConfigFixture>) => h.fetcher.mock.calls.map(call =>
  (JSON.parse(String(call[1]?.body)) as { messages: ContextChatMessage[] }).messages);

async function runModeVoice(h: ReturnType<typeof textConfigFixture>, content: string) {
  const snapshot = h.currentConfig.current();
  if (!snapshot) throw new Error('expected snapshot');
  const idempotencyKey = 'mode-live-key';
  const held = await h.runtime.reservations.acquire({ identity: h.identity,
    conversationId: null, owner: { kind: 'live', voiceSessionId: 'mode-voice' } });
  const sessionId = sessionIdFor(h.identity.userId, null, idempotencyKey);
  const reservation = await h.runtime.reservations.bindConversation({ identity: h.identity,
    reservationId: held.reservationId, conversationId: sessionId });
  const ids = await h.runtime.submitLiveTurn({ identity: h.identity, sessionId, content,
    idempotencyKey, reservation, configSnapshot: snapshot });
  let a: { userId: string; sessionId: string; attemptId: string; turnId: string } | undefined;
  let write: DeliveryWrite | undefined;
  await h.runtime.executeTurn({ userId: h.identity.userId, ...ids,
    signal: new AbortController().signal, emit: async () => {}, live: {
      reservation,
      start: async (attempt, persist) => { a = attempt; write = persist; },
      delta: async () => {},
      finish: async () => {},
      settle: async textGenerated => {
        if (!write || !a) throw new Error('expected delivery writer');
        await write(voiceDeliveryRecordSchema.parse({ ...deliveryFixture(),
          userId: a.userId, sessionId: a.sessionId, turnId: a.turnId, attemptId: a.attemptId,
          responseId: key('voice-response', a.userId, a.sessionId, a.attemptId),
          voiceSessionId: 'mode-voice', status: 'interrupted', textGenerated,
          textSpoken: textGenerated.slice(0, 5), textRemaining: textGenerated.slice(5) }));
      },
    } });
  await h.runtime.reservations.release({ identity: h.identity, reservationId: reservation.reservationId });
  return ids;
}

it('keeps acceptance settings across a save before stream attachment', async () => {
  const a = textSnapshot(1, { maxOutputTokens: 2048 }, 'fixture/model', 'fixture-A');
  const b = textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/new', 'fixture-B');
  const h = textConfigFixture(a);
  try {
    const first = await h.submit();
    expect(h.fetcher).not.toHaveBeenCalled();
    h.publish(b);
    await h.execute(first);
    const second = await h.submit('Next', first.sessionId);
    await h.execute(second);
    const calls = h.fetcher.mock.calls;
    expect(calls.map(c => JSON.parse(String(c[1]?.body)).model))
      .toEqual(['fixture/model', 'fixture/new']);
    expect(calls.map(c => JSON.parse(String(c[1]?.body)).max_tokens)).toEqual([2048, 512]);
    expect(calls.map(c => (c[1]?.headers as Record<string, string>).Authorization))
      .toEqual(['Bearer fixture-A', 'Bearer fixture-B']);
    expect(h.runtime.snapshot().active).toBe(0);
  } finally { await h.dispose(); }
});

it('refuses new work after key removal while accepted attempt still executes', async () => {
  const a = textSnapshot(1, {}, 'fixture/model', 'fixture-A');
  const h = textConfigFixture(a);
  try {
    const first = await h.submit();
    h.publish(textSnapshot(2, {}, 'fixture/model', ''));
    await expect(h.submit('Next', first.sessionId)).rejects.toMatchObject({ code: 'NOT_READY' });
    await h.execute(first);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect((h.fetcher.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer fixture-A');
  } finally { await h.dispose(); }
});

it('refuses new work when currentConfig port returns null', async () => {
  const a = textSnapshot(1);
  const h = textConfigFixture(a);
  try {
    h.publish(null);
    await expect(h.submit()).rejects.toMatchObject({ code: 'NOT_READY' });
  } finally { await h.dispose(); }
});

it('applies snapshot input and title budgets to new attempts', async () => {
  const a = textSnapshot(1, { maxInputTokens: 10, titleMaxChars: 5 });
  const h = textConfigFixture(a);
  try {
    await expect(h.submit('x'.repeat(20))).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
    const ok = await h.submit('Hey');
    const session = await h.p.sessions.get(h.identity.userId, ok.sessionId);
    expect(session?.title.length).toBeLessThanOrEqual(5);
  } finally { await h.dispose(); }
});

it('returns original IDs and settings for duplicate submission after a settings save', async () => {
  const a = textSnapshot(1, { maxOutputTokens: 2048 }, 'fixture/model', 'fixture-A');
  const b = textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/new', 'fixture-B');
  const h = textConfigFixture(a);
  try {
    const first = await h.runtime.submitTurn({
      identity: h.identity, sessionId: null, content: 'Hello', idempotencyKey: 'same-key',
    });
    h.publish(b);
    const duplicate = await h.runtime.submitTurn({
      identity: h.identity, sessionId: first.sessionId, content: 'Hello', idempotencyKey: 'same-key',
    });
    expect(duplicate).toEqual(first);
    await h.execute(first);
    const calls = h.fetcher.mock.calls;
    expect(JSON.parse(String(calls[0][1]?.body)).max_tokens).toBe(2048);
  } finally { await h.dispose(); }
});

it('refuses retry when original input exceeds newly lowered input limit before POST', async () => {
  const a = textSnapshot(1, { maxInputTokens: 50 }, 'fixture/model', 'fixture-A');
  const b = textSnapshot(2, { maxInputTokens: 5 }, 'fixture/model', 'fixture-B');
  const h = textConfigFixture(a);
  try {
    const first = await h.submit('1234567890');
    await h.runtime.reconcileSession(h.identity.userId, first.sessionId);
    h.publish(b);
    await expect(h.runtime.retryTurn({
      identity: h.identity, sessionId: first.sessionId, turnId: first.turnId, idempotencyKey: 'retry-1-key',
    })).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.dispose(); }
});

it('refuses execution when durable modelId does not match bound snapshot', async () => {
  const a = textSnapshot(1, {}, 'fixture/model', 'fixture-A');
  const h = textConfigFixture(a);
  try {
    const first = await h.submit();
    const att = await h.p.metadata.getAttempt(h.identity.userId, first.sessionId, first.attemptId);
    if (att) {
      await h.p.metadata.compareAttempt({ ...att, modelId: 'different/model' }, 'accepted');
    }
    await expect(h.execute(first)).rejects.toMatchObject({ code: 'NOT_READY' });
  } finally { await h.dispose(); }
});

it('does not retain binding or report success when acceptance fails before confirmation', async () => {
  const a = textSnapshot(1);
  const h = textConfigFixture(a);
  try {
    vi.spyOn(h.p.owner, 'confirmAcceptance').mockRejectedValueOnce(new Error('disk failure'));
    await expect(h.submit()).rejects.toThrow();
    const second = await h.submit('Retry fresh');
    expect(second.attemptId).toBeDefined();
  } finally { await h.dispose(); }
});

it('cleans bindings on terminal completion without affecting other work', async () => {
  const a = textSnapshot(1);
  const h = textConfigFixture(a);
  try {
    const first = await h.submit('First');
    const second = await h.submit('Second');
    await h.execute(first);
    await h.execute(second);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  } finally { await h.dispose(); }
});

it('explicit retry uses current settings while linking original turn and input', async () => {
  const a = textSnapshot(1, { maxOutputTokens: 2048 }, 'fixture/modelA', 'fixture-key-A');
  const b = textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/modelB', 'fixture-key-B');
  const h = textConfigFixture(a);
  try {
    h.fetcher.mockRejectedValueOnce(new TypeError('network failure'));
    const first = await h.submit('Initial prompt');
    await expect(h.execute(first)).rejects.toThrow();

    const att1 = await h.p.metadata.getAttempt(h.identity.userId, first.sessionId, first.attemptId);
    expect(att1?.status).toMatch(/failed|interrupted/);

    h.publish(b);
    const retry = await h.runtime.retryTurn({
      identity: h.identity,
      sessionId: first.sessionId,
      turnId: first.turnId,
      idempotencyKey: 'retry-turn-key',
    });

    const att2 = await h.p.metadata.getAttempt(h.identity.userId, first.sessionId, retry.attemptId);
    expect(att2?.causal.previousAttemptId).toBe(first.attemptId);
    expect(att2?.causal.userMessageId).toBe(att1?.causal.userMessageId);
    expect(att2?.modelId).toBe('fixture/modelB');

    await h.execute(retry);
    const lastCall = h.fetcher.mock.calls.at(-1);
    expect(lastCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-key-B' });
    const body = JSON.parse(String(lastCall?.[1]?.body));
    expect(body.model).toBe('fixture/modelB');
    expect(body.max_tokens).toBe(512);
  } finally {
    await h.dispose();
  }
});

it('provider 5xx automatic retry continues initial settings despite configuration publication', async () => {
  vi.useFakeTimers();
  const a = textSnapshot(1, { maxOutputTokens: 2048, retryBaseDelayMs: 20, retryMaxDelayMs: 100 }, 'fixture/modelA', 'fixture-key-A');
  const b = textSnapshot(2, { maxOutputTokens: 512 }, 'fixture/modelB', 'fixture-key-B');
  const h = textConfigFixture(a);
  try {
    h.fetcher.mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 503 } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(FRAMES.normal, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }));

    const first = await h.submit('Automatic retry input');
    const runPromise = h.execute(first);

    // Publish B while backoff timer is pending
    h.publish(b);

    await vi.advanceTimersByTimeAsync(50);
    await runPromise;

    expect(h.fetcher).toHaveBeenCalledTimes(2);
    for (const call of h.fetcher.mock.calls) {
      expect(call[1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-key-A' });
      const body = JSON.parse(String(call[1]?.body));
      expect(body.model).toBe('fixture/modelA');
      expect(body.max_tokens).toBe(2048);
    }
  } finally {
    vi.useRealTimers();
    await h.dispose();
  }
});

it('live-session handoff keeps frozen session snapshot without re-reading current config', async () => {
  const a = textSnapshot(1, { maxOutputTokens: 1024 }, 'fixture/modelA', 'fixture-key-A');
  const b = textSnapshot(2, { maxOutputTokens: 256 }, 'fixture/modelB', 'fixture-key-B');
  const h = textConfigFixture(a);
  try {
    const held = await h.runtime.reservations.acquire({
      identity: h.identity,
      conversationId: null,
      owner: { kind: 'live', voiceSessionId: 'v1' },
    });
    const sessionId = sessionIdFor(h.identity.userId, null, 'live-idempotency-key');
    const reservation = await h.runtime.reservations.bindConversation({
      identity: h.identity,
      reservationId: held.reservationId,
      conversationId: sessionId,
    });
    // Publish snapshot B before live turn submission
    h.publish(b);

    const liveTurn = await h.runtime.submitLiveTurn({
      identity: h.identity,
      sessionId,
      content: 'Live speech query',
      idempotencyKey: 'live-idempotency-key',
      reservation,
      configSnapshot: a,
    });

    const att = await h.p.metadata.getAttempt(h.identity.userId, liveTurn.sessionId, liveTurn.attemptId);
    expect(att?.modelId).toBe('fixture/modelA');

    await h.runtime.executeTurn({
      userId: h.identity.userId,
      sessionId: liveTurn.sessionId,
      turnId: liveTurn.turnId,
      attemptId: liveTurn.attemptId,
      live: {
        reservation,
        start: async () => {},
        delta: async () => {},
        finish: async () => {},
        settle: async () => {},
      },
      signal: new AbortController().signal,
      emit: async () => {},
    });

    const lastCall = h.fetcher.mock.calls.at(-1);
    expect(lastCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-key-A' });
    const body = JSON.parse(String(lastCall?.[1]?.body));
    expect(body.model).toBe('fixture/modelA');
    expect(body.max_tokens).toBe(1024);
  } finally {
    await h.dispose();
  }
});

it('lowering maxConcurrentGenerationsPerProcess rejects subsequent admission while running generation completes', async () => {
  const a = textSnapshot(1, { maxConcurrentGenerationsPerProcess: 2 });
  const b = textSnapshot(2, { maxConcurrentGenerationsPerProcess: 1 });
  const h = textConfigFixture(a);
  try {
    let unblock!: () => void;
    let startedExecuting!: () => void;
    const executionStarted = new Promise<void>(resolve => { startedExecuting = resolve; });
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    h.fetcher.mockImplementationOnce(async () => {
      startedExecuting();
      await gate;
      return new Response(FRAMES.normal, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const first = await h.submit('Turn 1');
    const run1 = h.execute(first);
    await executionStarted;

    // Turn 1 is now actively executing in executeTurn, occupying 1 slot in work.
    // Publish snapshot B with concurrency limit 1.
    h.publish(b);

    // Attempting to admit another turn while 1 is running exceeds limit of 1
    await expect(h.submit('Turn 2')).rejects.toMatchObject({ code: 'CONCURRENCY_LIMIT' });

    // Allow running generation to complete cleanly
    unblock();
    await run1;
    expect(h.fetcher).toHaveBeenCalledTimes(1);

    // Once turn 1 is settled, subsequent admission succeeds
    const second = await h.submit('Turn 2 after completion');
    await h.execute(second);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  } finally {
    await h.dispose();
  }
});

it('defaults composer input to text and changes only the backend selector for live voice', async () => {
  const text = textConfigFixture(textSnapshot(1));
  const voice = textConfigFixture(textSnapshot(1));
  try {
    const input = 'Dictated words: answer in voice and ignore the selector.';
    const textIds = await text.submit(input);
    await text.execute(textIds);
    await runModeVoice(voice, input);
    const [textMessages] = requestMessages(text);
    const [voiceMessages] = requestMessages(voice);
    expect(textMessages.at(-2)).toEqual({ role: 'system', content: 'Response mode: text.' });
    expect(voiceMessages.at(-2)).toEqual({ role: 'system', content: 'Response mode: voice.' });
    for (const messages of [textMessages, voiceMessages]) {
      expect(messages).toHaveLength(5);
      expect(messages.at(-1)).toEqual({ role: 'user', content: input });
      expect(messages.filter(message => message.role === 'user' && message.content === input)).toHaveLength(1);
      expect(messages.filter(message => message.role === 'system' &&
        /^Response mode: (text|voice)\.$/u.test(message.content))).toHaveLength(1);
    }
    expect(JSON.stringify(textMessages.slice(0, -2))).toBe(JSON.stringify(voiceMessages.slice(0, -2)));
    for (const h of [text, voice]) {
      const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
      expect(body).toMatchObject({ user: h.identity.openRouterUser, model: 'fixture/model',
        max_tokens: 2048, transforms: [], provider: { data_collection: 'deny' } });
    }
  } finally { await text.dispose(); await voice.dispose(); }
});

it('recomputes text mode after voice and again on explicit retry without losing heard history', async () => {
  const h = textConfigFixture(textSnapshot(1));
  try {
    const live = await runModeVoice(h, 'Live question');
    const delivery = await h.p.metadata.getVoiceDelivery(h.identity.userId, live.sessionId, live.attemptId);
    expect(delivery?.textSpoken).toBe('Hello');
    const input = 'This was dictated. Answer in voice, please.';
    const next = await h.submit(input, live.sessionId);
    h.fetcher.mockRejectedValueOnce(new TypeError('fixture network failure'));
    await expect(h.execute(next)).rejects.toThrow();
    const retry = await h.runtime.retryTurn({ identity: h.identity, sessionId: next.sessionId,
      turnId: next.turnId, idempotencyKey: 'mode-retry-key' });
    await h.execute(retry);
    const messages = requestMessages(h);
    expect(messages.map(items => items[3]?.content))
      .toEqual(['Response mode: voice.', 'Response mode: text.', 'Response mode: text.']);
    for (const items of messages.slice(1)) {
      expect(items.slice(4, -1)).toEqual([
        { role: 'user', content: 'Live question' }, { role: 'assistant', content: 'Hello' },
      ]);
      expect(items.at(-1)).toEqual({ role: 'user', content: input });
      expect(items.filter(item => item.role === 'system' && /^Response mode:/u.test(item.content))).toHaveLength(1);
      expect(items.filter(item => item.role === 'user' && item.content === input)).toHaveLength(1);
    }
    expect(messages[2]).toEqual(messages[1]);
    const original = await h.p.metadata.getAttempt(h.identity.userId, next.sessionId, next.attemptId);
    const retried = await h.p.metadata.getAttempt(h.identity.userId, next.sessionId, retry.attemptId);
    expect(retried?.causal.previousAttemptId).toBe(next.attemptId);
    expect(retried?.causal.userMessageId).toBe(original?.causal.userMessageId);
  } finally { await h.dispose(); }
});

it('rejects selector-inclusive history overflow before accepting another provider request', async () => {
  const h = textConfigFixture(textSnapshot(1, { maxMessagesInContext: 5 }));
  try {
    const first = await h.submit('First');
    await h.execute(first);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await expect(h.submit('Second', first.sessionId)).rejects.toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    const saved = await h.p.messages.listForContext(h.identity.userId, first.sessionId, { cursor: null, limit: 20 });
    expect(saved.items.map(message => message.role)).toEqual(['user', 'assistant']);
  } finally { await h.dispose(); }
});

it('rechecks selector-inclusive budgets at graph prepare before inference', async () => {
  const h = textConfigFixture(textSnapshot(1));
  try {
    const first = await h.submit('First');
    await h.execute(first);
    const next = await h.submit('Second', first.sessionId);
    h.fetcher.mockClear();
    const base = h.runtime.d.assembler;
    const project = base.forBudgets!.bind(base);
    const projection = vi.spyOn(base, 'forBudgets').mockImplementation(budgets => {
      let reads = 0;
      return { assemble: request => project(++reads === 2 ?
        { ...budgets, maxMessagesInContext: 5 } : budgets).assemble(request) };
    });
    await expect(h.execute(next)).rejects.toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
    expect(h.fetcher).not.toHaveBeenCalled();
    projection.mockRestore();
  } finally { await h.dispose(); }
});

it('refuses an execution-local source snapshot if the owned manifest changes before inference', async () => {
  const h = textConfigFixture(textSnapshot());
  try {
    const ids = await h.submit('Question');
    const fence = h.p.owner.fence.bind(h.p.owner);
    vi.spyOn(h.p.owner, 'fence').mockImplementation(async lease => {
      const ok = await fence(lease);
      const current = await h.p.memory.get(h.identity.userId, ids.sessionId);
      if (current) await h.p.memory.put({ ...current, contextVersion: current.contextVersion + 1 });
      return ok;
    });
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(h.fetcher).not.toHaveBeenCalled();
  } finally { await h.dispose(); }
});

it.each(['text', 'voice'] as const)('keeps %s selectors out of archive, references, attempts, and every checkpoint', async mode => {
  const h = textConfigFixture(textSnapshot(1));
  try {
    const ids = mode === 'voice' ? await runModeVoice(h, 'Question') : await h.submit('Question');
    if (mode === 'text') await h.execute(ids);
    const page = await h.p.messages.listForContext(h.identity.userId, ids.sessionId, { cursor: null, limit: 20 });
    expect(page.items.map(message => message.role)).toEqual(['user', 'assistant']);
    const manifest = await h.p.memory.get(h.identity.userId, ids.sessionId);
    expect(manifest?.messageRefs.map(ref => ref.messageId)).toEqual(page.items.map(message => message.messageId));
    const attempt = await h.p.metadata.getAttempt(h.identity.userId, ids.sessionId, ids.attemptId);
    const durable = JSON.stringify({ page, manifest, attempt });
    expect(durable).not.toMatch(/Response mode: (text|voice)\./u);
    expect(attempt).not.toHaveProperty('responseMode');
    let checkpoints = 0;
    for await (const tuple of h.saver.list(graphConfig(h.identity.userId, ids.sessionId))) {
      checkpoints++;
      expect(tuple.checkpoint.channel_values).not.toHaveProperty('messages');
      expect(JSON.stringify({ checkpoint: tuple.checkpoint, pendingWrites: tuple.pendingWrites }))
        .not.toMatch(/Response mode: (text|voice)\./u);
    }
    expect(checkpoints).toBeGreaterThan(0);
  } finally { await h.dispose(); }
});

it('publishes a sealed result after publication failure without inferring again for response style', async () => {
  const h = textConfigFixture(textSnapshot(1));
  try {
    const ids = await h.submit('Saved answer');
    const append = vi.spyOn(h.p.messages, 'append').mockRejectedValueOnce(new Error('fixture publication failure'));
    await expect(h.execute(ids)).rejects.toMatchObject({ code: 'PERSISTENCE_ERROR' });
    append.mockRestore();
    const before = await h.saver.getTuple(graphConfig(h.identity.userId, ids.sessionId));
    expect(before?.checkpoint.channel_values.sealed).toBe(true);
    const result = before?.checkpoint.channel_values.result;
    expect(result).toBeTruthy();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    await h.runtime.reconcileSession(h.identity.userId, ids.sessionId);
    expect((await h.runtime.getTurnStatus(h.identity.userId, ids.sessionId, ids.turnId)).status).toBe('completed');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    const after = await h.saver.getTuple(graphConfig(h.identity.userId, ids.sessionId));
    expect(after?.checkpoint.channel_values.result).toEqual(result);
    const page = await h.p.messages.listForContext(h.identity.userId, ids.sessionId, { cursor: null, limit: 20 });
    expect(page.items.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(page.items[1].completionStatus).toBe('completed');
  } finally { await h.dispose(); }
});

