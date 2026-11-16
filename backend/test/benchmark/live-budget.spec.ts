/**
 * ============================================================================
 * FILE: live-budget.spec.ts
 * LOCATION: backend/test/benchmark/live-budget.spec.ts
 * PURPOSE: Verify benchmark egress ceilings before any paid request is sent.
 * ROLE IN PROJECT: Offline checks for the explicitly authorized live baseline.
 * KEY COMPONENTS: Model, speech-character, audio, route and lifetime gates.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { LiveBudget } from '../../src/benchmark/live-budget.js';
import type { ProviderSocket } from '../../src/voice/providers/provider-link.js';

const model = 'anthropic/claude-haiku-5.5';
const request = () => ({ method: 'POST', body: JSON.stringify({ model, max_tokens: 6000,
  messages: [{ role: 'user', content: 'Synthetic baseline' }], plugins: [{ id: 'web', enabled: false }] }) });
const url = 'https://openrouter.ai/api/v1/chat/completions';

it('admits at most sixteen capped no-tool model dispatches and fails closed before egress', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'));
  const budget = new LiveBudget();
  for (let i = 0; i < 16; i++) await budget.fetch(fetcher)(url, request());
  await expect(budget.fetch(fetcher)(url, request())).rejects.toThrow('LIVE_BUDGET_DENIED');
  expect(fetcher).toHaveBeenCalledTimes(16);
});

it.each([
  { ...request(), body: JSON.stringify({ ...JSON.parse(request().body), tools: [{}] }) },
  { ...request(), body: JSON.stringify({ ...JSON.parse(request().body), max_tokens: 6001 }) },
  { ...request(), body: JSON.stringify({ ...JSON.parse(request().body), model: 'other' }) },
  { ...request(), body: JSON.stringify({ ...JSON.parse(request().body), messages: [{ content: 'x'.repeat(60000) }] }) },
  { ...request(), body: JSON.stringify({ ...JSON.parse(request().body), plugins: [{ id: 'web', enabled: true }] }) },
])('rejects uncapped/changed/tool-bearing model input before transport %#', async init => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(new LiveBudget().fetch(fetcher)(url, init)).rejects.toThrow('LIVE_BUDGET_DENIED');
  expect(fetcher).not.toHaveBeenCalled();
});

it('denies Calendar and every non-allowlisted HTTP route', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(new LiveBudget().fetch(fetcher)('https://www.googleapis.com/calendar/v3', request())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

function socket() {
  return Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0,
    send: vi.fn((_data: unknown, cb: (e?: Error) => void) => cb()), close: vi.fn(),
    terminate: vi.fn(), ping: vi.fn() }) as unknown as ProviderSocket;
}

it('caps all TTS input at 4000 UTF-8 bytes before forwarding Speak', () => {
  const raw = socket(), send = raw.send, b = new LiveBudget(), factory = b.sockets(() => raw);
  const s = factory(new URL('wss://api.deepgram.com/v2/speak?model=flux-haley-en'), {});
  s.send(JSON.stringify({ type: 'Speak', text: 'x'.repeat(4000) }), () => undefined);
  const callback = vi.fn();
  s.send(JSON.stringify({ type: 'Speak', text: 'x' }), callback);
  expect(send).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith(expect.any(Error));
  expect(raw.terminate).toHaveBeenCalled();
});

it('caps submitted STT audio at 60 seconds, counts multibyte speech conservatively and blocks new work after expiry', () => {
  let now = 0;
  const raw = socket(), send = raw.send, b = new LiveBudget(() => now);
  const s = b.sockets(() => raw)(new URL('wss://api.deepgram.com/v2/listen?model=flux-general-en'), {});
  s.send(new Uint8Array(60000 * 32), () => undefined);
  s.send(new Uint8Array(2560), () => undefined);
  expect(send).toHaveBeenCalledTimes(1);
  now = 900001;
  expect(() => b.sockets(() => raw)(new URL('wss://api.deepgram.com/v2/listen?model=flux-general-en'), {})).toThrow();
  expect(b.snapshot().conservativeMaximumUsd).toBeLessThan(1);
  b.stop();
});

it('rejects unexpected speech models and routes before creating a socket', () => {
  const factory = vi.fn(() => socket());
  const b = new LiveBudget();
  expect(() => b.sockets(factory)(new URL('wss://api.deepgram.com/v1/listen?model=other'), {})).toThrow();
  expect(factory).not.toHaveBeenCalled();
});

it('blocks at the exact monotonic active deadline without another outbound dispatch', async () => {
  let now = 0;
  const upstream = vi.fn<typeof fetch>(async () => new Response('{}'));
  const budget = new LiveBudget(() => now);
  try {
    await budget.fetch(upstream)(url, request());
    now = 900000;
    await expect(budget.fetch(upstream)(url, request())).rejects.toThrow('LIVE_BUDGET_DENIED');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().denial).toBe('LIVE_BUDGET_DENIED');
  } finally { budget.stop(); }
});

it('caps the 33rd speech socket, multibyte TTS at 4000 bytes and revokes retained wrappers on stop', () => {
  const sockets = Array.from({ length: 32 }, () => socket());
  const b = new LiveBudget();
  let index = 0;
  const factory = b.sockets(() => sockets[index++]);
  const listen = () => new URL('wss://api.deepgram.com/v2/listen?model=flux-general-en');
  for (let i = 0; i < 32; i++) factory(listen(), {});
  expect(() => factory(listen(), {})).toThrow('LIVE_BUDGET_DENIED');
  b.stop();
  expect(sockets.every(item => (item.terminate as unknown as { mock: { calls: unknown[] } })
    .mock.calls.length >= 1)).toBe(true);
  const revoked = socket(), stopped = new LiveBudget();
  stopped.sockets(() => revoked)(listen(), {});
  stopped.stop();
  expect((revoked.terminate as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  expect(() => b.sockets(() => socket())(listen(), {})).toThrow('LIVE_BUDGET_DENIED');

  const speak = socket(), tts = new LiveBudget();
  const wrapped = tts.sockets(() => speak)(new URL('wss://api.deepgram.com/v2/speak?model=flux-haley-en'), {});
  const callback = vi.fn();
  wrapped.send(JSON.stringify({ type: 'Speak', text: '界'.repeat(1333) }), callback); // 3999 bytes
  expect(callback).toHaveBeenCalledWith();
  wrapped.send(JSON.stringify({ type: 'Speak', text: '界' }), callback); // 4002 bytes
  expect(callback.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);
  expect(tts.snapshot().ttsUtf8Bytes).toBe(3999);
  tts.stop();
});
