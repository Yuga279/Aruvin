/**
 * ============================================================================
 * FILE: live-track-playback.ts
 * LOCATION: frontend/src/features/voice/audio/live-track-playback.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Owns one attached LiveKit remote audio track and its proven 24 kHz playout cursor.
 *
 * ROLE IN PROJECT:
 *    Gives the live WebRTC client immediate local silence, a fresh output element
 *    per generated response, and a played-sample cursor bounded by the server's
 *    audio.watermark/audio.end sample bounds. Legacy PCM playback stays separate.
 *
 * KEY COMPONENTS:
 *    - LiveTrackPlayback: Element/track ownership, begin/watermark/end bounds,
 *      output observation, interrupt/dispose teardown.
 *    - LivePlaybackProgress: playedSamples/playedMs/proof snapshot for controls.
 *    - LiveTrackPlaybackOptions: Injectable monotonic clock, playback gate, blocked hook.
 * ============================================================================
 */

import type { RemoteAudioTrack } from 'livekit-client';
import { clampPlayedSamplesToWatermark } from '../../../api/voice-protocol.ts';
import type { VoiceAudioWatermarkPayload, VoicePlaybackProof } from '../../../api/voice-protocol.ts';

export type LivePlaybackProgress = { playedSamples: number; playedMs: number; proof: VoicePlaybackProof };
export type LiveTrackPlaybackOptions = {
  now?: () => number;
  canPlayback?: () => boolean;
  blocked?: () => void;
};

type ResponseRef = { turnId: string; responseId: string };
type SampleBounds = { firstAudioSample?: number; lastAudioSample?: number };

/** The application reference is 24 kHz mono; the browser output clock is wall time. */
const SAMPLES_PER_MS = 24;
/** HTMLMediaElement.HAVE_CURRENT_DATA: something is decoded and playable. */
const HAVE_CURRENT_DATA = 2;

export class LiveTrackPlayback {
  private readonly createElement: () => HTMLAudioElement;
  private readonly options: LiveTrackPlaybackOptions;
  private element: HTMLAudioElement | undefined;
  private track: RemoteAudioTrack | undefined;
  private attached = false;
  private ref: ResponseRef | null = null;
  private first = 0;
  private cursor = 0;
  private ceiling = 0;
  private final = false;
  private proof: VoicePlaybackProof = 'proven';
  private frozen: LivePlaybackProgress = { playedSamples: 0, playedMs: 0, proof: 'proven' };
  private observedAt: number | null = null;
  private exact = 0;
  private credited = 0;

  constructor(element: () => HTMLAudioElement, options: LiveTrackPlaybackOptions = {}) {
    this.createElement = element;
    this.options = options;
  }

  attach(track: RemoteAudioTrack): void {
    if (this.track === track && this.element) return;
    this.release();
    this.track = track;
    const element = this.mount();
    if (this.ref) this.audible(element);
  }

  begin(turnId: string, responseId: string, firstAudioSample?: number): void {
    this.release();
    const first = firstAudioSample ?? this.cursor;
    this.ref = { turnId, responseId };
    this.first = first;
    this.cursor = first;
    this.ceiling = first;
    this.final = false;
    this.proof = 'proven';
    this.observedAt = null;
    this.exact = 0;
    this.credited = 0;
    this.commit();
    if (this.track) this.audible(this.mount());
  }

  watermark(event: VoiceAudioWatermarkPayload): void {
    const ref = this.ref;
    if (!ref || event.turnId !== ref.turnId || event.responseId !== ref.responseId) return;
    if (event.firstAudioSample !== this.first || event.lastAudioSample < this.ceiling) {
      throw new Error('VOICE_SEQUENCE_ERROR');
    }
    this.ceiling = event.lastAudioSample;
    if (event.final) this.final = true;
  }

  end(event: { turnId: string; responseId: string } & SampleBounds): void {
    const ref = this.ref;
    if (!ref || event.turnId !== ref.turnId || event.responseId !== ref.responseId) return;
    if (event.lastAudioSample !== undefined) {
      if (event.firstAudioSample !== undefined && event.firstAudioSample !== this.first) {
        throw new Error('VOICE_SEQUENCE_ERROR');
      }
      if (event.lastAudioSample < this.ceiling) throw new Error('VOICE_SEQUENCE_ERROR');
      this.ceiling = event.lastAudioSample;
      this.final = true;
      return;
    }
    if (this.ceiling > this.first) this.final = true;
  }

  activeResponse(): { turnId: string; responseId: string } | null {
    return this.ref ? { turnId: this.ref.turnId, responseId: this.ref.responseId } : null;
  }

  progress(): LivePlaybackProgress {
    if (!this.ref) return this.frozen;
    const now = this.now();
    if (!this.observing()) {
      if (this.observedAt !== null && this.ceiling > this.cursor) this.proof = 'unproven';
      this.rearm();
      return this.commit();
    }
    if (this.ceiling <= this.cursor || this.observedAt === null) {
      this.observedAt = now;
      this.exact = 0;
      this.credited = 0;
      return this.commit();
    }
    const elapsed = Math.max(0, now - this.observedAt);
    this.observedAt = now;
    this.exact += elapsed * SAMPLES_PER_MS;
    // Fractional samples stay in `exact` across calls, so no observation discards the remainder:
    // two 0.1 ms observations credit 5 samples (4.8), never 4.
    const credited = Math.round(this.exact);
    const delta = credited - this.credited;
    if (delta > 0) {
      this.credited = credited;
      this.cursor = clampPlayedSamplesToWatermark(this.first, this.cursor, delta, this.ceiling);
    }
    return this.commit();
  }

  isDrained(): boolean {
    return this.ref !== null && this.final && this.proof === 'proven' && this.cursor >= this.ceiling;
  }

  interrupt(): LivePlaybackProgress {
    const snapshot = this.progress();
    this.stop();
    this.frozen = snapshot;
    return snapshot;
  }

  dispose(): void {
    this.stop();
    this.track = undefined;
  }

  /** Releases output and proof state without disturbing the last committed cursor. */
  private stop(): void {
    this.ref = null;
    this.final = false;
    this.ceiling = this.first;
    this.rearm();
    this.release();
  }

  private commit(): LivePlaybackProgress {
    this.frozen = { playedSamples: this.cursor, playedMs: Math.floor(this.cursor / SAMPLES_PER_MS),
      proof: this.proof };
    return this.frozen;
  }

  private rearm(): void {
    this.observedAt = null;
    this.exact = 0;
    this.credited = 0;
  }

  private now(): number {
    return this.options.now ? this.options.now() : performance.now();
  }

  /**
   * Element state is read synchronously here rather than through DOM event listeners:
   * every consumer polls progress(), and a structural element double has no events.
   */
  private observing(): boolean {
    const element = this.element;
    if (!this.ref || this.proof !== 'proven' || !this.attached || !element) return false;
    if (this.ceiling <= this.cursor) return false;
    return element.muted === false && element.paused === false && !element.error &&
      element.readyState >= HAVE_CURRENT_DATA &&
      this.track?.mediaStreamTrack?.readyState === 'live' &&
      this.options.canPlayback?.() !== false;
  }

  private mount(): HTMLAudioElement {
    const element = this.createElement();
    element.muted = true;
    this.track?.attach?.(element);
    this.element = element;
    this.attached = true;
    return element;
  }

  private audible(element: HTMLAudioElement): void {
    element.muted = false;
    const started = element.play?.();
    if (started && typeof started.catch === 'function') {
      void started.catch(() => {
        this.proof = 'unproven';
        this.options.blocked?.();
      });
    }
  }

  private release(): void {
    const element = this.element;
    this.element = undefined;
    if (!element) return;
    element.muted = true;
    element.pause?.();
    if (this.attached) this.track?.detach?.(element);
    this.attached = false;
    element.srcObject = null;
    element.remove?.();
  }
}
