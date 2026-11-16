/**
 * ============================================================================
 * FILE: runner.spec.ts
 * LOCATION: backend/test/benchmark/runner.spec.ts
 * PURPOSE: Verify real SSE consumption, safety gates, timeouts and log isolation.
 * ROLE IN PROJECT: Exercises the benchmark without calling external providers.
 * KEY COMPONENTS: runText, blockedReason, safeEvidence, correlate.
 * ============================================================================
 */
import { describe, expect, it, vi } from 'vitest';
import { benchmarkConfigSchema, blockedReason, runText, safeEvidence, correlate, hashId,
  isVoiceDeliveryConfirmed } from '../../src/benchmark/runner.js';
import { scenarios } from '../../src/benchmark/report.js';
import { StreamTiming } from '../../src/benchmark/stream-timing.js';
import { Telemetry } from '../../src/operations/telemetry.js';

const config = () => benchmarkConfigSchema.parse({ start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z', timeZone: 'Etc/UTC' });
const ids = { sessionId: 's', turnId: 't', attemptId: 'a', userMessageId: 'u', streamPath: '/unused' };
const frame = (event: unknown, sequence = 0) => `data: ${JSON.stringify({ protocolVersion: 1, ...ids,
  userMessageId: undefined, streamPath: undefined, sequence, event })}\n\n`;

describe('benchmark runner safety and transport', () => {
  it('accepts an explicit voice-only run without enabling paid or Calendar access', () => {
    const c = benchmarkConfigSchema.parse({ ...config(), voiceOnly: true });
    expect(c.voiceOnly).toBe(true);
    expect(c.allowPaid).toBe(false);
    expect(c.allowCalendarData).toBe(false);
  });
  it('requires explicit paid/data/mutation permission and never grants voice tool access', () => {
    const c = config(), cases = scenarios(c), mutation = cases.find(s => s.mutation)!;
    expect(blockedReason(cases[0], c, false)).toBe('dry-run');
    expect(blockedReason(cases[0], c, true)).toBe('paid-call-approval-required');
    Object.assign(c, { allowPaid: true, budgetCeilingUsd: 1, serverLog: 'local.jsonl' });
    expect(blockedReason(mutation, c, true)).toBe('calendar-data-approval-required');
    c.allowCalendarData = true;
    expect(blockedReason(mutation, c, true)).toBe('disposable-calendar-mutation-approval-required');
    expect(() => benchmarkConfigSchema.parse({ ...c, baseUrl: 'https://example.com/api' })).toThrow();
    expect(() => benchmarkConfigSchema.parse({ ...c, baseUrl: 'http://user:secret@localhost/api' })).toThrow();
  });

  it('uses protocol 3, distinct idempotency keys, first text and durable status verification', async () => {
    const body = frame({ type: 'delta', text: 'secret response' })
      + frame({ type: 'completed', assistantMessageId: 'm', outcome: 'completed' }, 1);
    const requests: RequestInit[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      requests.push(init!);
      if (init?.method === 'POST') return new Response(JSON.stringify(ids), { status: 202 });
      const url = _url instanceof Request ? _url.url : _url instanceof URL ? _url.href : _url;
      if (url.endsWith('/stream')) return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
      return new Response(JSON.stringify({ status: 'completed' }));
    });
    const scenario = scenarios(config())[0];
    const a = await runText(scenario, config(), fetcher), b = await runText(scenario, config(), fetcher);
    expect(a).toMatchObject({ outcome: 'completed', completed: true, sessionId: 's', turnId: 't' });
    expect(a.firstTextMs).toBeGreaterThanOrEqual(a.acceptanceMs!);
    expect(JSON.stringify(a)).not.toContain('secret response');
    expect(JSON.parse(requests[0].body as string).calendarProtocol).toBe(3);
    expect(JSON.parse(requests[0].body as string).idempotencyKey).not.toBe(JSON.parse(requests[3].body as string).idempotencyKey);
    expect(b.outcome).toBe('completed');
  });

  it('does not mistake provisional output, mismatched turns, or EOF for completion', async () => {
    for (const stream of [frame({ type: 'delta', text: 'hello' }), frame({ type: 'delta', text: 'hello' }).replace('"turnId":"t"', '"turnId":"wrong"')]) {
      const fetcher = vi.fn<typeof fetch>(async (_u, init) => init?.method === 'POST'
        ? new Response(JSON.stringify(ids), { status: 202 }) : new Response(stream));
      expect((await runText(scenarios(config())[0], config(), fetcher)).outcome).toBe('failed');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it('records timeout once without retrying inference', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_u, init) => {
      await new Promise<void>((_yes, no) => init!.signal!.addEventListener('abort', () => no(new Error('private')), { once: true }));
      throw new Error('unreachable');
    });
    const c = { ...config(), timeoutMs: 10 };
    expect((await runText(scenarios(c)[0], c, fetcher)).outcome).toBe('timeout');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('projects redacted timing metadata and isolates turns/attempts', () => {
    const safe = safeEvidence({ kind: 'process', stage: 'model-stream-end', clockMs: 10, durationMs: 5,
      turnId: hashId('t'), attemptId: hashId('a'), prompt: 'private payload', authorization: 'secret', unknown: 'secret' })!;
    expect(JSON.stringify(safe)).not.toMatch(/private|secret|authorization|prompt/);
    expect(correlate([safe, { ...safe, attemptId: hashId('other') }, { ...safe, turnId: hashId('other') }],
      { ...ids, durationMs: 1, firstTextMs: null, acceptanceMs: null, outcome: 'completed' })).toEqual([safe]);
  });

  it('selects transport explicitly while preserving old defaults and approval gates', () => {
    const base = { start: '2026-11-06T10:00:00Z', end: '2026-11-06T11:00:00Z', timeZone: 'Etc/UTC' };
    expect(benchmarkConfigSchema.parse(base).transport).toBe('websocket');
    const rtc = benchmarkConfigSchema.parse({ ...base, transport: 'webrtc', voiceOnly: true });
    expect(rtc.allowPaid).toBe(false);
    expect(rtc.allowCalendarData).toBe(false);
    expect(rtc.allowMutations).toBe(false);
    expect(blockedReason(scenarios(rtc).find(s => s.mode === 'voice')!, rtc, true))
      .toBe('paid-call-approval-required');
    expect(() => benchmarkConfigSchema.parse({ ...base, transport: 'auto' })).toThrow();
    expect(() => benchmarkConfigSchema.parse({ ...base, participantToken: 'private' })).toThrow();
  });

  it('does not confirm delivery from another turn in the same voice session', () => {
    const wire = { voiceSessionId: 'v', turnId: 't', durationMs: 1,
      firstTextMs: null, acceptanceMs: null, outcome: 'failed' };
    const settlement = { kind: 'voice-pipeline', sessionId: hashId('v'), turnId: hashId('t'),
      stage: 'delivery-settled' };
    const terminal = { kind: 'process', turnId: hashId('other'), stage: 'terminal', chat: 'completed' };
    expect(isVoiceDeliveryConfirmed([settlement, terminal], wire)).toBe(false);
    expect(isVoiceDeliveryConfirmed([settlement, { ...terminal, turnId: hashId('t') }], wire)).toBe(true);
    expect(isVoiceDeliveryConfirmed([{ ...settlement, code: 'VOICE_DELIVERY_UNKNOWN' },
      { ...terminal, turnId: hashId('t') }], wire)).toBe(false);
    expect(isVoiceDeliveryConfirmed([settlement, { ...terminal, turnId: hashId('t'), chat: 'failed' }], wire)).toBe(false);
    expect(isVoiceDeliveryConfirmed([settlement, { ...terminal, turnId: hashId('t') }],
      { ...wire, voiceSessionId: undefined })).toBe(false);
  });

  it('retains new model timing/count fields through production telemetry without payloads', () => {
    const logs: string[] = [], telemetry = new Telemetry(line => logs.push(line));
    const timing = new StreamTiming(fields => telemetry.event('process', fields), { dispatchId: 'd', attemptId: 'a' });
    timing.frame({ choices: [{ delta: { content: 'PRIVATE' } }], usage: { completion_tokens: 15000 } });
    timing.end(true);
    const event = JSON.parse(logs.at(-1)!) as Record<string, unknown>;
    expect(event).toMatchObject({ stage: 'model-stream-end', completionTokens: 15000, state: 'ok' });
    expect(event.clockMs).toBeTypeOf('number');
    expect(event.clockOriginMs).toBeTypeOf('number');
    expect(logs.join('')).not.toContain('PRIVATE');
  });
});
