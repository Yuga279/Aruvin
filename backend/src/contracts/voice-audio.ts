/**
 * ============================================================================
 * FILE: voice-audio.ts
 * LOCATION: backend/src/contracts/voice-audio.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide binary audio framing encoder and decoder for PCM16 audio chunks.
 *
 * ROLE IN PROJECT:
 *    Enforces the 16-byte little-endian binary header protocol for voice audio
 *    streaming over WebSocket channels.
 *
 * KEY COMPONENTS:
 *    - VOICE_AUDIO_HEADER_BYTES: 16-byte fixed binary header constant
 *    - VoiceAudioFrame: Audio frame representation
 *    - encodeVoiceAudio: Encodes PCM16 payload with LE header
 *    - decodeVoiceAudio: Validates magic byte, lengths, and decodes frame
 * ============================================================================
 */

export const VOICE_AUDIO_HEADER_BYTES = 16;
export type VoiceAudioFrame = { kind: 1 | 2; flags: 0 | 1;
  sequence: number; offsetMs: number; pcm: Uint8Array };
const uint32 = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
function valid(frame: VoiceAudioFrame): boolean {
  return (frame.kind === 1 || frame.kind === 2) && (frame.flags === 0 || frame.flags === 1) &&
    uint32(frame.sequence) && uint32(frame.offsetMs) && frame.pcm instanceof Uint8Array &&
    frame.pcm.byteLength % 2 === 0 && (frame.pcm.byteLength > 0 || frame.flags === 1) &&
    frame.pcm.byteLength <= (frame.kind === 1 ? 2560 : 9600);
}
export function encodeVoiceAudio(frame: VoiceAudioFrame): Uint8Array {
  if (!valid(frame)) throw new Error('INVALID_AUDIO_FRAME');
  const bytes = new Uint8Array(VOICE_AUDIO_HEADER_BYTES + frame.pcm.byteLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0xaf, 1, frame.kind, frame.flags]);
  view.setUint32(4, frame.sequence, true);
  view.setUint32(8, frame.offsetMs, true);
  view.setUint32(12, frame.pcm.byteLength, true);
  bytes.set(frame.pcm, VOICE_AUDIO_HEADER_BYTES);
  return bytes;
}
export function decodeVoiceAudio(bytes: Uint8Array): VoiceAudioFrame {
  if (bytes.byteLength < VOICE_AUDIO_HEADER_BYTES || bytes[0] !== 0xaf || bytes[1] !== 1)
    throw new Error('INVALID_AUDIO_FRAME');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12, true) !== bytes.byteLength - VOICE_AUDIO_HEADER_BYTES)
    throw new Error('INVALID_AUDIO_FRAME');
  const frame: VoiceAudioFrame = { kind: bytes[2] as 1 | 2, flags: bytes[3] as 0 | 1,
    sequence: view.getUint32(4, true), offsetMs: view.getUint32(8, true),
    pcm: bytes.subarray(VOICE_AUDIO_HEADER_BYTES) };
  if (!valid(frame)) throw new Error('INVALID_AUDIO_FRAME');
  return frame;
}
