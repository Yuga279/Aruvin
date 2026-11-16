/**
 * ============================================================================
 * FILE: provider-link.ts
 * LOCATION: backend/src/voice/providers/provider-link.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide low-level WebSocket connection management, bounded buffering, and error handling.
 *
 * ROLE IN PROJECT:
 *    Underlies Nova STT, Flux STT, and Flux TTS provider adapters, managing
 *    deadlines, sanitized error reporting, and single-consumer event queues.
 *
 * KEY COMPONENTS:
 *    - ProviderSocket / SocketFactory: Abstraction over ws WebSocket
 *    - ProviderFault: Standardized error carrier for voice fault domain
 *    - EventQueue: Bounded, single-consumer async iterable event queue
 *    - ProviderLink: Connection lifecycle, bounded buffer, deadline enforcement
 * ============================================================================
 */

import { EventEmitter } from 'node:events';
import WebSocket, { type RawData } from 'ws';
import { z } from 'zod';
import type { VoiceFault } from '../../contracts/voice.js';
import type { VoiceErrorCode, VoiceRecovery } from '../../contracts/voice-wire.js';
import type { VoiceConfig } from '../../platform/config/voice-config.js';

export interface ProviderSocket extends EventEmitter {
  readyState: number; bufferedAmount: number;
  send(data: string | Uint8Array, callback: (error?: Error) => void): void;
  close(): void; terminate(): void; ping(): void;
  pause?(): void; resume?(): void;
}
export type SocketFactory = (url: URL, headers: Record<string, string>) => ProviderSocket;
export const socketFactory: SocketFactory = (url, headers) => new WebSocket(url, {
  headers, maxPayload: 131072, perMessageDeflate: false, followRedirects: false,
});
export class ProviderFault extends Error {
  readonly fault: VoiceFault;
  constructor(code: VoiceErrorCode, recovery: VoiceRecovery = 'return_to_chat', recoverable = true) {
    super(code); this.fault = { code, recovery, recoverable };
  }
}
export const uint = z.number().int().nonnegative().max(0xffffffff);
export const providerId = z.string().min(1).max(128);
export const providerText = z.string().max(32000);
export function sameAudio(value: object, expected: object): boolean {
  const entries = Object.entries(expected);
  return Object.keys(value).length === entries.length && entries.every(([key, v]) =>
    Object.hasOwn(value, key) && (value as Record<string, unknown>)[key] === v);
}
export function providerUrl(config: VoiceConfig, path: string, params: Record<string, string>): URL {
  const url = new URL(path, config.deepgram.apiBase);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}
export class EventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private wake: (() => void) | undefined;
  private ended = false;
  private claimed = false;
  constructor(private readonly maxBytes: number, private readonly bytes: (event: T) => number,
    private readonly changed?: (bytes: number, count: number) => void,
    private readonly merge?: (previous: T, next: T) => T | undefined) {}
  private notify() { this.changed?.(this.values.reduce((n, v) => n + this.bytes(v), 0), this.values.length); }
  push(event: T): boolean {
    if (this.ended) return false;
    if (this.values.reduce((n, v) => n + this.bytes(v), 0) + this.bytes(event) > this.maxBytes)
      return false;
    const previous = this.values.at(-1);
    const combined = previous === undefined ? undefined : this.merge?.(previous, event);
    if (combined !== undefined) {
      this.values[this.values.length - 1] = combined; this.notify(); this.wake?.(); return true;
    }
    if (this.values.length >= 256) return false;
    this.values.push(event); this.notify(); this.wake?.(); return true;
  }
  discard(predicate: (event: T) => boolean) { this.values = this.values.filter(v => !predicate(v)); this.notify(); }
  retainTerminalEvidence(event: T) {
    if (!this.ended && this.values.length < 257) { this.values.push(event); this.wake?.(); }
  }
  end(terminal?: T) {
    if (this.ended) return;
    // ponytail: <=256 normal events plus one delivery-evidence and one terminal fault; upgrade to a deque if this ceiling grows.
    if (terminal !== undefined) this.values.push(terminal);
    this.ended = true; this.wake?.();
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    if (this.claimed) throw new ProviderFault('VOICE_INVALID_STATE');
    this.claimed = true;
    while (true) {
      if (this.values.length) { const value = this.values.shift()!; this.notify(); yield value; continue; }
      if (this.ended) return;
      await new Promise<void>(resolve => { this.wake = resolve; }); this.wake = undefined;
    }
  }
}
export class ProviderLink<T extends { type: string }> {
  readonly queue: EventQueue<T>;
  socket!: ProviderSocket;
  active = true;
  paused = false;
  onFailure: ((error: ProviderFault) => void) | undefined;
  onFinish: (() => void) | undefined;
  private pendingBytes = 0;
  private pending = new Set<(error: ProviderFault) => void>();
  private readyResolve: (() => void) | undefined;
  private readyReject: ((error: ProviderFault) => void) | undefined;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private abort = () => this.fail(new ProviderFault('VOICE_SESSION_ENDED', 'none', false));
  constructor(private readonly cfg: VoiceConfig, private readonly signal: AbortSignal,
    private readonly unavailable: 'STT_UNAVAILABLE' | 'TTS_UNAVAILABLE',
    readonly recovery: VoiceRecovery, maxEventBytes: number, eventBytes: (event: T) => number,
    private readonly errorEvent: (fault: VoiceFault) => T,
    private readonly onMessage: (message: Record<string, unknown> | Uint8Array) => void,
    private readonly factory: SocketFactory = socketFactory, backpressure = false,
    merge?: (previous: T, next: T) => T | undefined) {
    // Reserve one maxPayload for already-decoded socket data after pause. No unbounded PCM queue.
    this.queue = new EventQueue(maxEventBytes + (backpressure ? 131072 : 0), eventBytes, backpressure ? (bytes, count) => {
      if ((bytes >= maxEventBytes || count >= 128) && !this.paused) { this.paused = true; this.socket?.pause?.(); }
      else if (bytes <= maxEventBytes / 2 && count <= 64 && this.paused) { this.paused = false; this.socket?.resume?.(); }
    } : undefined, merge);
  }
  deadline(ms: number, action: () => void, reading = false) {
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => {
      this.timers.delete(timer);
      if (reading && this.paused && this.active) { timer = setTimeout(expire, ms); this.timers.add(timer); }
      else action();
    };
    timer = setTimeout(expire, ms);
    this.timers.add(timer);
    return () => { clearTimeout(timer); this.timers.delete(timer); };
  }
  emit(event: T) {
    if (this.active && !this.queue.push(event)) this.fail(new ProviderFault('AUDIO_BUFFER_OVERFLOW', this.recovery));
  }
  async start(url: URL, waitConnected = false): Promise<void> {
    if (this.signal.aborted) throw new ProviderFault('VOICE_SESSION_ENDED', 'none', false);
    if (!this.cfg.deepgram.apiKey) throw new ProviderFault(this.unavailable, this.recovery);
    const ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    const cancel = this.deadline(this.cfg.limits.connectMs, () => this.fail(new ProviderFault('VOICE_CONNECT_TIMEOUT', this.recovery)));
    this.signal.addEventListener('abort', this.abort, { once: true });
    try {
      this.socket = this.factory(url, { Authorization: `Token ${this.cfg.deepgram.apiKey}` });
      this.socket.on('open', () => { if (!waitConnected) this.readyResolve?.(); });
      this.socket.on('message', (data: RawData, binary: boolean) => {
        if (!this.active) return;
        try {
          const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
          if (bytes.byteLength > 131072) throw new ProviderFault('AUDIO_BUFFER_OVERFLOW', this.recovery);
          if (binary) { this.onMessage(bytes); return; }
          const m = z.record(z.unknown()).parse(JSON.parse(bytes.toString('utf8')));
          if (m.type === 'Error') { this.fail(new ProviderFault(this.unavailable, this.recovery)); return; }
          this.onMessage(m);
          if (m.type === 'Connected') this.readyResolve?.();
        } catch { this.fail(new ProviderFault(this.unavailable, this.recovery)); }
      });
      this.socket.on('error', () => this.fail(new ProviderFault(this.unavailable, this.recovery)));
      this.socket.on('close', () => { if (this.active) this.fail(new ProviderFault(this.unavailable, this.recovery)); });
      this.socket.on('unexpected-response', (_request: unknown, response: { statusCode?: number; resume(): void }) => {
        response.resume();
        this.fail(new ProviderFault(response.statusCode === 429 ? 'VOICE_PROVIDER_RATE_LIMITED' : this.unavailable, this.recovery));
      });
      await ready;
    } catch (error) {
      const fault = error instanceof ProviderFault ? error : new ProviderFault(this.unavailable, this.recovery);
      this.fail(fault); await ready.catch(() => {}); throw fault;
    } finally { cancel(); this.readyResolve = undefined; this.readyReject = undefined; }
  }
  heartbeat(kind: 'nova' | 'ping') {
    let waitingPong = false;
    let cancelPong: (() => void) | undefined;
    this.socket.on('pong', () => { waitingPong = false; cancelPong?.(); });
    const pulse = () => {
      if (!this.active) return;
      // Pausing PCM also pauses pong frames. Ping without a pong deadline so Deepgram
      // inactivity cannot close a backpressured socket; playback stall/run deadlines still apply.
      if (this.paused) {
        if (kind !== 'nova') {
          try { this.socket.ping(); } catch { this.fail(new ProviderFault(this.unavailable, this.recovery)); }
        }
        if (this.active) this.deadline(kind === 'nova' ? 4000 : 20000, pulse);
        return;
      }
      if (kind === 'nova') {
        void this.json({ type: 'KeepAlive' }).catch(() => {});
      } else {
        waitingPong = true;
        cancelPong = this.deadline(5000, () => {
          if (waitingPong && !this.paused) this.fail(new ProviderFault(this.unavailable, this.recovery));
        });
        try { this.socket.ping(); } catch { this.fail(new ProviderFault(this.unavailable, this.recovery)); }
      }
      if (this.active) this.deadline(kind === 'nova' ? 4000 : 20000, pulse);
    };
    this.deadline(kind === 'nova' ? 4000 : 20000, pulse);
  }
  send(data: string | Uint8Array, byteLimit = 131072): Promise<void> {
    if (!this.active || this.socket.readyState !== 1) return Promise.reject(new ProviderFault('VOICE_INVALID_STATE', this.recovery));
    const size = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (this.pending.size >= 256 || this.pendingBytes + this.socket.bufferedAmount + size > byteLimit) {
      const error = new ProviderFault('AUDIO_BUFFER_OVERFLOW', this.recovery); this.fail(error); return Promise.reject(error);
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingBytes += size;
      let finished = false;
      const finish = (error?: ProviderFault) => {
        if (finished) return; finished = true; cancel(); this.pending.delete(finish); this.pendingBytes -= size;
        if (error) reject(error); else resolve();
      };
      const cancel = this.deadline(this.cfg.limits.inputQueueMs, () => this.fail(new ProviderFault(this.unavailable, this.recovery)));
      this.pending.add(finish);
      try { this.socket.send(data, error => {
        if (error) this.fail(new ProviderFault(this.unavailable, this.recovery)); else finish();
      }); } catch { this.fail(new ProviderFault(this.unavailable, this.recovery)); }
    });
  }
  json(value: unknown) { return this.send(JSON.stringify(value)); }
  fail(error: ProviderFault) {
    if (!this.active) return;
    this.onFailure?.(error);
    this.readyReject?.(error); this.queue.end(this.errorEvent(error.fault)); this.dispose(true, error);
  }
  finish() {
    if (this.active) { this.onFinish?.(); this.queue.end(); this.dispose(false); }
  }
  private dispose(force: boolean, error = new ProviderFault('VOICE_SESSION_ENDED', 'none', false)) {
    this.active = false; this.signal.removeEventListener('abort', this.abort);
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    for (const reject of this.pending) reject(error);
    if (!this.socket) return;
    if (force) this.socket.terminate(); else {
      const timer = setTimeout(() => this.socket.terminate(), 250); timer.unref();
      this.socket.once('close', () => clearTimeout(timer)); this.socket.close();
    }
  }
}
