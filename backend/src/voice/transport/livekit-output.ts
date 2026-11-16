/**
 * ============================================================================
 * FILE: livekit-output.ts
 * LOCATION: backend/src/voice/transport/livekit-output.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Publish Aurvin's 24 kHz assistant PCM through a bounded LiveKit AudioSource.
 *
 * ROLE IN PROJECT:
 *    Copies unaligned provider buffers, tracks the generated sample cursor for
 *    response-bound watermarks, and fences superseded audio at the media layer.
 *
 * KEY COMPONENTS:
 *    - LiveKitOutput: Aligned conversion, bounded capture queue, generation fencing.
 * ============================================================================
 */

import { AudioFrame } from '@livekit/rtc-node';
import {
  LIVE_WEBRTC_AUDIO as A,
  type VoiceErrorCode,
  type VoiceResponseRef as Ref,
  type VoiceServerPayload,
} from '../../contracts/voice-wire.js';
import { fault } from '../session/voice-session.options.js';

type Source = { captureFrame(frame: AudioFrame): Promise<void>; clearQueue(): void };
type Part = { generation: number; frame: AudioFrame; bytes: number };
type Active = Ref & { firstAudioSample: number; queuedSamples: number; last: number | null };

export class LiveKitOutput {
  private active?: Active;
  private cursor = 0;
  private sequence = 0;
  private generation = 0;
  private queue: Part[] = [];
  private held = 0;
  private running = false;
  private closed = false;
  private failed = false;

  constructor(
    private readonly source: Source,
    private readonly queueMs: number,
    private readonly send: (payload: VoiceServerPayload) => void,
    private readonly fail: (code: VoiceErrorCode) => void,
  ) {}

  outputSamples() {
    return Math.ceil(this.cursor / 24) * 24;
  }

  event(payload: VoiceServerPayload) {
    if (this.closed) return;
    if (payload.type === 'audio.start') {
      if (this.active) fault('VOICE_INVALID_STATE');
      this.failed = false;
      this.cursor = this.outputSamples();
      this.active = {
        turnId: payload.turnId,
        responseId: payload.responseId,
        firstAudioSample: this.cursor,
        queuedSamples: 0,
        last: null,
      };
      payload = {
        ...payload,
        firstAudioSample: this.cursor,
        firstAudioSequence: this.sequence,
      };
    } else if (payload.type === 'audio.end') {
      if (!this.matches(payload)) fault('VOICE_BINDING_MISMATCH');
      payload = {
        ...payload,
        lastAudioSequence: this.active!.last,
        firstAudioSample: this.active!.firstAudioSample,
        lastAudioSample: this.cursor,
        totalAudioSamples: this.cursor - this.active!.firstAudioSample,
      };
      this.active = undefined;
    }
    this.send(payload);
  }

  private matches(ref: Ref) {
    return this.active?.turnId === ref.turnId && this.active.responseId === ref.responseId;
  }

  audio(ref: Ref, pcm: Uint8Array) {
    if (this.closed || this.failed || !this.matches(ref)) return;
    if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > A.ttsMaxChunkBytes) {
      fault('INVALID_AUDIO_FRAME');
    }
    if (this.held + pcm.byteLength > this.queueMs * 48) {
      this.failure('AUDIO_BUFFER_OVERFLOW');
      return;
    }
    const samples = new Int16Array(pcm.byteLength / 2);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true);
    this.queue.push({
      generation: this.generation,
      bytes: pcm.byteLength,
      frame: new AudioFrame(samples, A.ttsSampleRateHz, A.ttsChannels, samples.length),
    });
    this.held += pcm.byteLength;
    this.cursor += samples.length;
    this.active!.queuedSamples += samples.length;
    this.active!.last = this.sequence++;
    this.send({
      type: 'audio.watermark',
      turnId: ref.turnId,
      responseId: ref.responseId,
      firstAudioSample: this.active!.firstAudioSample,
      queuedSamples: this.active!.queuedSamples,
      lastAudioSample: this.cursor,
      final: false,
    });
    this.drain();
  }

  finalize(ref: Ref) {
    if (this.closed || !this.matches(ref)) return;
    this.send({
      type: 'audio.watermark',
      turnId: ref.turnId,
      responseId: ref.responseId,
      firstAudioSample: this.active!.firstAudioSample,
      queuedSamples: this.active!.queuedSamples,
      lastAudioSample: this.cursor,
      final: true,
    });
  }

  private drain() {
    if (this.running || this.closed) return;
    this.running = true;
    void (async () => {
      try {
        while (this.queue.length && !this.closed) {
          const part = this.queue.shift()!;
          try {
            await this.source.captureFrame(part.frame);
          } finally {
            this.held -= part.bytes;
          }
          // ponytail: one capture in flight; clear its late native residue before any newer generation.
          if (part.generation !== this.generation) this.source.clearQueue();
        }
      } catch {
        this.failure('VOICE_DELIVERY_UNKNOWN');
      } finally {
        this.running = false;
      }
    })();
  }

  private failure(code: VoiceErrorCode) {
    if (this.closed || this.failed) return;
    this.failed = true;
    try {
      this.clear();
    } catch {
      // Native source may already be gone.
    }
    this.fail(code);
  }

  clear() {
    this.generation++;
    this.held -= this.queue.reduce((sum, part) => sum + part.bytes, 0);
    this.queue = [];
    this.source.clearQueue();
  }

  invalidate(ref: Ref) {
    if (!this.matches(ref)) return;
    const last = this.active!.last;
    const first = this.active!.firstAudioSample;
    const end = this.cursor;
    this.active = undefined;
    this.clear();
    this.send({
      type: 'response.cancelled',
      turnId: ref.turnId,
      responseId: ref.responseId,
      lastAudioSequence: last,
      firstAudioSample: first,
      lastAudioSample: end,
      totalAudioSamples: end - first,
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.active = undefined;
    this.clear();
  }
}
