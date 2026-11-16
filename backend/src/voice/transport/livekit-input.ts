/**
 * ============================================================================
 * FILE: livekit-input.ts
 * LOCATION: backend/src/voice/transport/livekit-input.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Convert decoded LiveKit microphone frames into exact 2560-byte STT frames.
 *
 * ROLE IN PROJECT:
 *    Applies Aurvin's existing 16 kHz/80 ms speech framing, a five-second quiet
 *    suspension gate with bounded pre-roll, and finite forwarding into LiveFlow.
 *
 * KEY COMPONENTS:
 *    - LiveKitInput: PCM accumulator, quiet gate and bounded STT-forward queue.
 * ============================================================================
 */

import { LIVE_WEBRTC_AUDIO as A, type VoiceErrorCode } from '../../contracts/voice-wire.js';
import { voiceError } from '../session/voice-session.options.js';

type DecodedFrame = {
  data: Int16Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
};

export class LiveKitInput {
  private partial = new Uint8Array(A.sttFrameBytes);
  private used = 0;
  private quietMs = 0;
  private suspended = false;
  private waking = false;
  private uploading = true;
  private enabled = true;
  private closed = false;
  private preRoll: Uint8Array[] = [];
  private queue: Uint8Array[] = [];
  private running = false;
  private inFlight = false;
  private readonly maxFrames: number;

  constructor(
    inputQueueMs: number,
    private readonly write: (pcm: Uint8Array) => Promise<void>,
    private readonly suspend: () => void,
    private readonly resume: () => void,
    private readonly fail: (code: VoiceErrorCode) => void,
  ) {
    this.maxFrames = Math.floor(inputQueueMs / A.sttFrameMs);
  }

  get bufferedFrames() {
    return this.preRoll.length + this.queue.length + Number(this.inFlight);
  }

  private failure(code: VoiceErrorCode) {
    if (!this.closed) {
      this.close();
      this.fail(code);
    }
  }

  push(frame: DecodedFrame) {
    if (this.closed || !this.enabled) return;
    if (frame.sampleRate !== A.sttSampleRateHz || frame.channels !== A.sttChannels ||
      frame.samplesPerChannel !== frame.data.length || !frame.data.length ||
      frame.data.byteLength > this.maxFrames * A.sttFrameBytes) {
      this.failure('INVALID_AUDIO_FRAME');
      return;
    }
    for (const sample of frame.data) {
      if (this.closed) break;
      this.partial[this.used++] = sample & 255;
      this.partial[this.used++] = (sample >> 8) & 255;
      if (this.used === A.sttFrameBytes) {
        const pcm = this.partial;
        this.partial = new Uint8Array(A.sttFrameBytes);
        this.used = 0;
        this.accept(pcm);
      }
    }
  }

  private accept(pcm: Uint8Array) {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let speech = false;
    for (let window = 0; window < 4; window++) {
      let active = false;
      for (let i = window * 320; i < (window + 1) * 320; i++) {
        if (Math.abs(view.getInt16(i * 2, true)) >= A.quietPeakThreshold) active = true;
      }
      speech ||= active;
      this.quietMs = active ? 0 : this.quietMs + A.quietFrameWindowMs;
    }
    if (!this.suspended && this.quietMs >= A.quietHangoverMs) {
      this.suspended = true;
      this.uploading = false;
      this.waking = false;
      this.queue = [];
      this.preRoll = [];
      this.remember(pcm);
      this.suspend();
      return;
    }
    if (this.suspended && !this.waking) {
      this.remember(pcm);
      if (!speech) return;
      this.waking = true;
      const onset = this.preRoll;
      this.preRoll = [];
      for (const part of onset) this.enqueue(part);
      if (!this.closed) this.resume();
      return;
    }
    this.enqueue(pcm);
  }

  private remember(pcm: Uint8Array) {
    this.preRoll.push(pcm);
    while (this.preRoll.length && (this.preRoll.length > A.quietPreRollFrames ||
      this.bufferedFrames > this.maxFrames)) {
      this.preRoll.shift();
    }
  }

  private enqueue(pcm: Uint8Array) {
    if (this.closed) return;
    if (this.bufferedFrames >= this.maxFrames) {
      this.failure('AUDIO_BUFFER_OVERFLOW');
      return;
    }
    this.queue.push(pcm);
    this.drain();
  }

  private drain() {
    if (this.running || !this.uploading || !this.enabled || this.closed) return;
    this.running = true;
    void (async () => {
      try {
        while (this.queue.length && this.uploading && this.enabled && !this.closed) {
          const pcm = this.queue.shift()!;
          this.inFlight = true;
          try {
            await this.write(pcm);
          } finally {
            this.inFlight = false;
          }
        }
      } catch (error) {
        this.failure(voiceError(error, 'STT_UNAVAILABLE').code);
      } finally {
        this.running = false;
        if (this.queue.length) this.drain();
      }
    })();
  }

  setUploading(enabled: boolean) {
    if (this.closed || this.uploading === enabled) return;
    this.uploading = enabled;
    if (enabled) {
      this.suspended = false;
      this.waking = false;
      this.quietMs = 0;
      this.preRoll = [];
      this.drain();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.reset();
  }

  private reset() {
    this.used = 0;
    this.partial = new Uint8Array(A.sttFrameBytes);
    this.queue = [];
    this.preRoll = [];
    this.quietMs = 0;
    this.suspended = false;
    this.waking = false;
    this.uploading = true;
  }

  close() {
    this.closed = true;
    this.enabled = false;
    this.reset();
  }
}
