/**
 * ============================================================================
 * FILE: voice-delivery.ts
 * LOCATION: backend/src/voice/agent/voice-delivery.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Lease-bound generated-versus-heard evidence tracker and delivery settlement.
 *
 * ROLE IN PROJECT:
 *    Maintains sequential VoiceDeliveryRecord snapshots during live turn execution,
 *    records speech progress/completion, and settles final heard status under lease.
 *
 * KEY COMPONENTS:
 *    - VoiceDelivery: Serialized delivery state machine and settlement engine.
 *    - Immediate speech dispatch with background 100ms/512-character journal coalescing.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import type { TtsEvent, VoiceDeliveryRecord } from '../../contracts/voice.js';
import { voiceDeliveryRecordSchema } from '../../contracts/voice.js';
import type { DeliveryWrite } from '../../chat-runtime/ports.js';
import { AppError } from '../../platform/errors/app-error.js';
import {
  isCanvasArtifactProjection,
  isCanvasArtifactProjectionList,
  type CanvasArtifactProjection,
} from '../../contracts/voice-wire.js';

type Ref = { turnId: string; responseId: string };
type SpeechWriter = { speak(c: Ref & { text: string }): Promise<void>; flush(c: Ref): Promise<void> };
type Evidence = Extract<TtsEvent, { type: 'speech-interrupted' }>;

export class VoiceDelivery {
  private record: VoiceDeliveryRecord;
  private chain = Promise.resolve();
  private invalid = false;
  private ended = false;
  private sent = '';
  private interrupted: Evidence | null = null;
  private synthesized = false;
  private wake?: () => void;
  private lastProgress = Date.now();
  private readonly started = Date.now();
  private pendingPlayback?: number;
  private savingPlayback = false;
  private playbackFailure?: unknown;
  private observedSamples = 0;
  private invalidAt?: number;
  private generated: string;
  private dirtySince?: number;
  private generatedTimer?: ReturnType<typeof setTimeout>;
  private generatedTask?: Promise<void>;
  private generatedFailure?: unknown;
  private textClosed = false;
  private finishTask?: Promise<void>;
  private speechDead = false;
  private speechTask?: Promise<void>;
  private speechId: string | null = null;

  constructor(
    seed: VoiceDeliveryRecord,
    private readonly base: number,
    private readonly write: DeliveryWrite,
    private readonly speech: SpeechWriter,
    private readonly deadlineMs: number,
    private readonly lifetime?: { activeMs: number; stallMs: number }
  ) {
    this.record = voiceDeliveryRecordSchema.parse(seed);
    this.generated = this.record.textGenerated;
    this.speechId = this.record.speechId;
  }

  current(): VoiceDeliveryRecord { return this.record; }

  private ref(): Ref { return { turnId: this.record.turnId, responseId: this.record.responseId }; }

  private enqueue<T = void>(action: () => Promise<T>): Promise<T> {
    const result = this.chain.then(action);
    // A rejected caller must observe its failure, without poisoning terminal evidence.
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async update(patch: Partial<VoiceDeliveryRecord>) {
    if (this.ended) return;
    const old = this.record;
    const next = voiceDeliveryRecordSchema.parse({ ...old, ...(this.speechId !== null ? { speechId: this.speechId } : {}),
      ...patch, sequence: old.sequence + 1, eventId: randomUUID(), updatedAt: new Date().toISOString() });
    await this.write(next, old.sequence);
    this.record = next;
    this.wake?.();
  }

  start() { return this.enqueue(() => this.write(this.record)); }

  invalidate() {
    this.invalidAt ??= Date.now();
    this.invalid = true;
    this.clearGeneratedTimer();
    this.wake?.();
    if (!this.generatedFailure && !this.ended && this.generated !== this.record.textGenerated)
      void this.drainAllGenerated().catch(() => undefined);
  }

  private checkGenerated() {
    if (this.generatedFailure) throw this.generatedFailure;
  }

  private clearGeneratedTimer() {
    clearTimeout(this.generatedTimer);
    this.generatedTimer = undefined;
  }

  private dispatchSpeech(): Promise<void> {
    if (this.invalid || this.ended || this.generated.length <= this.sent.length)
      return this.speechTask ?? Promise.resolve();
    if (this.speechTask) return this.speechTask;
    const task = (async () => {
      while (!this.invalid && !this.ended && this.generated.length > this.sent.length) {
        const target = this.generated;
        let end = target.length;
        if (!this.textClosed && end > this.sent.length && /[\uD800-\uDBFF]/u.test(target[end - 1] ?? '')) end--;
        if (end <= this.sent.length) break;
        const delta = target.slice(this.sent.length, end);
        this.lastProgress = Date.now();
        try {
          await this.speech.speak({ ...this.ref(), text: delta });
          this.sent += delta;
          this.speechDead = false;
        } catch {
          this.speechDead = true;
          break;
        }
      }
    })().finally(() => {
      if (this.speechTask === task) this.speechTask = undefined;
    });
    this.speechTask = task;
    return task;
  }

  private async drainGenerated() {
    this.checkGenerated();
    const text = this.generated;
    this.dirtySince = undefined;
    if (text !== this.record.textGenerated) await this.update({ textGenerated: text });
  }

  private saveGenerated() {
    this.clearGeneratedTimer();
    if (this.generatedTask) return this.generatedTask;
    const task = this.enqueue(() => this.drainGenerated()).catch(error => {
      this.generatedFailure ??= error;
      this.invalidate();
      throw error;
    }).finally(() => {
      if (this.generatedTask === task) this.generatedTask = undefined;
      if (!this.invalid && !this.generatedFailure && this.generated !== this.record.textGenerated)
        this.scheduleGenerated();
    });
    this.generatedTask = task;
    return task;
  }

  private scheduleGenerated() {
    if (this.generatedTimer || this.generatedTask || this.ended) return;
    const due = this.generated.length - this.record.textGenerated.length >= 512 ? 0
      : Math.max(0, 100 - (Date.now() - (this.dirtySince ?? Date.now())));
    this.generatedTimer = setTimeout(() => {
      this.generatedTimer = undefined;
      void this.saveGenerated().catch(() => undefined);
    }, due);
  }

  private async drainAllGenerated() {
    do {
      await this.saveGenerated();
      this.checkGenerated();
    } while (!this.ended && this.generated !== this.record.textGenerated);
  }

  async delta(text: string) {
    this.checkGenerated();
    if (this.invalid || this.ended || !text) return;
    if (this.textClosed) throw new AppError('INVALID_REQUEST', 'Speech generation has ended.');
    voiceDeliveryRecordSchema.parse({ ...this.record, textGenerated: this.generated + text });
    this.generated += text;
    this.dirtySince ??= Date.now();
    // ponytail: coalesce journal writes in background 100ms/512-char batches while dispatching Speak immediately.
    if (this.generated.length - this.record.textGenerated.length >= 512 || !this.record.textGenerated)
      void this.saveGenerated().catch(() => undefined);
    else this.scheduleGenerated();
    await this.dispatchSpeech();
  }

  finish() {
    this.textClosed = true;
    return this.finishTask ??= (async () => {
      if (!this.speechDead) await this.dispatchSpeech();
      const flushSpeech = (async () => {
        if (!this.invalid && !this.ended && this.sent && !this.speechDead) {
          try { await this.speech.flush(this.ref()); }
          catch { this.speechDead = true; }
        }
      })();
      await Promise.all([flushSpeech, this.drainAllGenerated()]);
      this.checkGenerated();
    })();
  }

  async artifact(artifact: CanvasArtifactProjection): Promise<boolean> {
    if (!isCanvasArtifactProjection(artifact) || artifact.responseId !== this.record.responseId) {
      throw new AppError('INVALID_REQUEST', 'Invalid canvas artifact projection.');
    }
    await this.drainAllGenerated();
    this.checkGenerated();

    return this.enqueue(async () => {
      if (this.ended || this.invalid) return false;
      const currentList = this.record.canvasArtifacts ?? [];
      const existing = currentList.find(a => a.ordinal === artifact.ordinal);
      if (existing) {
        if (
          existing.kind === artifact.kind &&
          existing.subType === artifact.subType &&
          existing.title === artifact.title &&
          existing.rawSource === artifact.rawSource &&
          existing.responseId === artifact.responseId
        ) {
          return true;
        }
        throw new AppError('INVALID_REQUEST', 'Conflicting canvas artifact ordinal.');
      }
      const nextList = [...currentList, artifact].sort((a, b) => a.ordinal - b.ordinal);
      if (!isCanvasArtifactProjectionList(nextList)) {
        throw new AppError('INVALID_REQUEST', 'Invalid canvas artifact list.');
      }
      try {
        await this.update({ canvasArtifacts: nextList });
        return true;
      } catch (error) {
        this.generatedFailure ??= error;
        this.invalidate();
        throw error;
      }
    });
  }

  playback(socketSamples: number) {
    return this.enqueue(async () => {
      const relative = socketSamples - this.base;
      if (!Number.isSafeInteger(relative) || relative < 0 || relative < (this.record.playedSamples ?? 0))
        throw new AppError('INVALID_REQUEST', 'Playback evidence regressed.');
      if (this.ended) return;
      if (relative === this.record.playedSamples) return;
      this.lastProgress = Date.now();
      await this.update({ playedSamples: relative });
    });
  }

  observePlayback(socketSamples: number) {
    const relative = socketSamples - this.base;
    if (!Number.isSafeInteger(relative) || relative < this.observedSamples)
      throw new AppError('INVALID_REQUEST', 'Playback evidence regressed.');
    if (relative > this.observedSamples) this.lastProgress = Date.now();
    this.observedSamples = relative;
    this.pendingPlayback = socketSamples;
    if (this.savingPlayback) return;
    this.savingPlayback = true;
    void this.enqueue(async () => {
      try {
        while (this.pendingPlayback !== undefined && !this.ended) {
          const samples = this.pendingPlayback - this.base;
          this.pendingPlayback = undefined;
          if (samples !== this.record.playedSamples) {
            await this.update({ playedSamples: samples });
          }
        }
      } finally { this.savingPlayback = false; }
    }).catch(error => { this.playbackFailure = error; this.invalidate(); });
  }

  event(e: Exclude<TtsEvent, { type: 'audio' } | { type: 'error' }>) {
    return this.enqueue(async () => {
      if (e.turnId !== this.record.turnId || e.responseId !== this.record.responseId)
        throw new AppError('INVALID_REQUEST', 'Speech response binding is invalid.');
      if (this.ended) return;
      if (e.type === 'speech-interrupted' &&
        (e.audioPlayedMs === null || e.textSpoken === null || e.textRemaining === null) && !this.invalid) {
        // Retired-socket unknown evidence is durable; it is never a guessed spoken prefix.
        this.lastProgress = Date.now();
        this.speechId = null;
        if (this.record.speechId !== null) await this.update({ speechId: null });
        return;
      }
      if (this.speechId !== null && e.speechId !== this.speechId)
        throw new AppError('INVALID_REQUEST', 'Speech identity changed.');
      if (e.speechId !== null) this.speechId = e.speechId;
      if (e.type === 'speech-started') {
        this.lastProgress = Date.now();
        return;
      }
      if (e.type === 'speech-interrupted') {
        this.interrupted ??= e;
        this.invalidate();
        await this.drainGenerated();
      }
      if (e.type === 'speech-completed') this.synthesized = true;
      this.lastProgress = Date.now();
      await this.update({ ...(e.speechId !== null ? { speechId: e.speechId } : {}),
        ...(e.type === 'speech-completed' ? { audioDurationMs: e.audioDurationMs,
          ...(e.audioSamples === undefined ? {} : { audioSamples: e.audioSamples }) } : {}) });
    });
  }

  private proof(): Partial<VoiceDeliveryRecord> | null {
    const generated = this.record.textGenerated, samples = this.record.playedSamples ?? 0;
    if (!this.sent) return { status: this.invalid ? 'cancelled' : generated ? 'failed' : 'completed',
      audioDurationMs: 0, audioPlayedMs: 0, playedSamples: 0, textSpoken: '', textRemaining: generated };
    const e = this.interrupted;
    if (e) {
      if (e.audioPlayedMs === null || e.textSpoken === null || e.textRemaining === null ||
        e.textSpoken + e.textRemaining !== this.sent || !generated.startsWith(e.textSpoken) ||
        e.audioPlayedMs < Math.floor(samples / 24) ||
        (this.record.audioDurationMs !== null && e.audioPlayedMs > this.record.audioDurationMs))
        return { status: 'unknown', textSpoken: null, textRemaining: null };
      return { status: 'interrupted', textSpoken: e.textSpoken,
        textRemaining: generated.slice(e.textSpoken.length), audioPlayedMs: e.audioPlayedMs,
        playedSamples: Math.max(samples, e.audioPlayedMs * 24) };
    }
    const expected = this.record.audioSamples ?? (this.record.audioDurationMs === null ? null : this.record.audioDurationMs * 24);
    if (!this.invalid && this.synthesized && expected === 0)
      return { status: 'failed', textSpoken: null, textRemaining: null };
    if (!this.invalid && this.synthesized && generated === this.sent && this.record.audioDurationMs !== null &&
      samples === expected) return { status: 'completed', textSpoken: generated,
        textRemaining: '', audioPlayedMs: this.record.audioDurationMs };
    return null;
  }

  async settle(finalGenerated: string, signal?: AbortSignal) {
    const abort = () => this.invalidate();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    try {
      await this.drainAllGenerated();
      this.checkGenerated();
      await this.enqueue(async () => {
        if (this.playbackFailure) throw this.playbackFailure;
        if (!finalGenerated.startsWith(this.generated))
          throw new AppError('NOT_READY', 'Generated speech evidence disagrees.');
        if (finalGenerated !== this.record.textGenerated) await this.update({ textGenerated: finalGenerated });
        this.generated = finalGenerated;
      });
      const cleanupUntil = Date.now() + this.deadlineMs;
      const deadline = () => this.lifetime && !this.invalid
        ? Math.min(this.started + this.lifetime.activeMs, this.lastProgress + this.lifetime.stallMs)
        : this.invalid && this.lifetime ? Math.min(this.started + this.lifetime.activeMs + this.deadlineMs,
          this.invalidAt! + this.deadlineMs) : cleanupUntil;
      while (!this.proof() && Date.now() < deadline()) {
        await new Promise<void>(resolve => {
          let timer: ReturnType<typeof setTimeout>;
          const done = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
          timer = setTimeout(done, Math.max(1, deadline() - Date.now()));
          this.wake = done;
        });
        await this.chain;
      }
      await this.enqueue(async () => {
        if (this.playbackFailure) throw this.playbackFailure;
        await this.update(this.proof() ?? { status: 'unknown', textSpoken: null, textRemaining: null });
        this.ended = true;
      });
    } finally {
      this.clearGeneratedTimer();
      signal?.removeEventListener('abort', abort);
    }
  }
}
