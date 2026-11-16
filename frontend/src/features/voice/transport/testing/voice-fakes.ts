/**
 * ============================================================================
 * FILE: voice-fakes.ts
 * LOCATION: frontend/src/features/voice/transport/testing/voice-fakes.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic test doubles and fixtures for voice transport and WebSocket tests.
 *
 * ROLE IN PROJECT:
 *    Provides fake WebSocket implementation and P1-compatible session/control/audio
 *    fixture helpers for unit and pipeline tests.
 *
 * KEY COMPONENTS:
 *    - FakeSocket: Mock WebSocket tracking readyState, sent frames, bufferedAmount.
 *    - session(): Helper producing valid CreateVoiceSessionResponse payloads.
 *    - control(): Helper producing serialized server control messages.
 *    - ready(): Helper producing session.ready server events.
 *    - output(): Helper generating binary 24 kHz audio frames.
 * ============================================================================
 */

import { vi } from 'vitest'
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  type CreateVoiceSessionResponse, type VoiceMode, type VoiceServerPayload } from '../../../../api/voice-protocol'
import { encodeVoiceAudio } from '../../../../api/voice-audio'

export class FakeSocket {
  readyState = 0
  bufferedAmount = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: (string | Uint8Array)[] = []
  send(data: string | Uint8Array) { this.sent.push(data) }
  close = vi.fn(() => { this.readyState = 3 })
  open() { this.readyState = 1; this.onopen?.() }
  receive(data: unknown) { this.onmessage?.({ data } as MessageEvent) }
  lose() { this.readyState = 3; this.onclose?.() }
  asSocket() { return this as unknown as WebSocket }
}

export function session(epoch = 1, mode: VoiceMode = 'live'): CreateVoiceSessionResponse {
  return { protocolVersion: 1, sessionId: 'v1', conversationId: null, mode,
    connectionEpoch: epoch, websocketUrl: '/api/voice', expiresAt: '2099-10-08T00:20:00Z',
    effectiveAudioSettings: { input: INPUT_AUDIO, output: mode === 'live' ? OUTPUT_AUDIO : null },
    limits: { ...DEFAULT_VOICE_LIMITS } }
}

export function control(payload: VoiceServerPayload, sequence: number, epoch = 1) {
  return JSON.stringify({ protocolVersion: 1, sessionId: 'v1', connectionEpoch: epoch,
    eventId: `e${epoch}-${sequence}`, sequence, ...payload })
}

export function ready(sequence = 0, epoch = 1, mode: VoiceMode = 'live') {
  return control({ type: 'session.ready', limits: session(epoch, mode).limits,
    effectiveAudioSettings: session(epoch, mode).effectiveAudioSettings }, sequence, epoch)
}

export function output(sequence = 0, offsetMs = 0) {
  return encodeVoiceAudio({ kind: 2, flags: 0, sequence, offsetMs, pcm: new Uint8Array(4800) }).buffer
}
