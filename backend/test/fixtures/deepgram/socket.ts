/**
 * ============================================================================
 * FILE: socket.ts
 * LOCATION: backend/test/fixtures/deepgram/socket.ts
 * ============================================================================
 *
 * PURPOSE:
 *    In-memory WebSocket mock and synthetic message fixtures for Deepgram tests.
 *
 * ROLE IN PROJECT:
 *    Provides deterministic, offline socket simulation and helper builders
 *    for Nova STT, Flux STT, and Flux TTS provider adapter unit tests.
 *
 * KEY COMPONENTS:
 *    - FakeSocket: EventEmitter-based in-memory WebSocket mock
 *    - harness: Factory creating fake sockets and recording connection attempts
 *    - Fixture builders: novaResult, turn, connected, metadata, collect, tick
 * ============================================================================
 */

import { EventEmitter } from 'node:events';
import { loadVoiceConfig } from '../../../src/platform/config/voice-config.js';
import { INPUT_AUDIO, OUTPUT_AUDIO } from '../../../src/contracts/voice-wire.js';
import type { SocketFactory } from '../../../src/voice/providers/provider-link.js';
import { VoiceAccounting } from '../../../src/voice/usage/voice-accounting.js';

export class FakeSocket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  sent: (string | Uint8Array)[] = [];
  holdSends = false;
  callbacks: ((error?: Error) => void)[] = [];
  terminated = false;
  pings = 0;
  paused = false;
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  open() { this.readyState = 1; this.emit('open'); }
  json(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  binary(bytes: Uint8Array) { this.emit('message', Buffer.from(bytes), true); }
  send(data: string | Uint8Array, callback: (error?: Error) => void) {
    this.sent.push(typeof data === 'string' ? data : Uint8Array.from(data));
    if (this.holdSends) this.callbacks.push(callback); else callback();
  }
  ping() { this.pings++; this.emit('pong'); }
  close() { this.readyState = 3; this.emit('close', 1000); }
  terminate() { this.terminated = true; this.close(); }
  controls() { return this.sent.filter((s): s is string => typeof s === 'string').map(s => JSON.parse(s) as unknown); }
}
export function harness(connected: Record<string, unknown> | null = null) {
  const sockets: FakeSocket[] = [];
  const requests: { url: URL; headers: Record<string, string> }[] = [];
  const factory: SocketFactory = (url, headers) => {
    const socket = new FakeSocket();
    sockets.push(socket); requests.push({ url, headers });
    queueMicrotask(() => { socket.open(); if (connected) socket.json(connected); });
    return socket;
  };
  const accounting = new VoiceAccounting({ userId: 'fixture-user', voiceSessionId: 'fixture-voice',
    conversationId: () => null, config: config(), write: async () => undefined });
  return { sockets, requests, factory, accounting };
}
export const config = () => loadVoiceConfig({ DEEPGRAM_API_KEY: 'test-secret-not-real' });
export const input = (mode: 'dictation' | 'live', signal = new AbortController().signal) =>
  ({ mode, locale: 'en-US' as const, audio: INPUT_AUDIO, abortSignal: signal });
export const output = (signal = new AbortController().signal) => ({ audio: OUTPUT_AUDIO, abortSignal: signal });
export async function collect<T>(events: AsyncIterable<T>, target: T[]) {
  for await (const event of events) target.push(event);
}
export const tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
export const novaResult = (text: string, final: boolean, start = 0, done = false) => ({
  type: 'Results', start, duration: 0.8, channel_index: [0, 1],
  is_final: final, speech_final: final, from_finalize: done,
  channel: { alternatives: [{ transcript: text, confidence: 0.99, words: [] }] },
});
export const turn = (event: string, sequence: number, text = '', index = 0) => ({
  type: 'TurnInfo', request_id: 'fixture-request', sequence_id: sequence,
  event, turn_index: index, transcript: text, audio_window_start: 0,
  audio_window_end: 0.8, words: [], end_of_turn_confidence: 0.9,
  ...(event === 'EndOfTurn' ? { trigger: 'model' } : {}),
});
export const connected = { type: 'Connected', request_id: 'fixture-request', sequence_id: 0,
  model_name: 'flux-haley-en', model_version: 'fixture-2026-10-08', model_uuids: [] };
export const metadata = (speech = 'dg_sp_000000000001', duration = 100, chars = 12) => ({
  speech_id: speech, audio_duration_ms: duration, input_character_count: chars,
  billable_character_count: chars,
  controls_applied: { pronunciations_applied: 0, breaks_applied: 0, pronunciation_warnings: 0 },
});
