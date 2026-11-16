/**
 * ============================================================================
 * FILE: livekit-control.ts
 * LOCATION: backend/src/voice/transport/livekit-control.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Carry existing voice JSON envelopes over reliable LiveKit data packets.
 *
 * ROLE IN PROJECT:
 *    Frames outbound server events with P1b's bounded chunking, reassembles
 *    inbound client packets, and fences identity, epoch, ordering and size.
 *
 * KEY COMPONENTS:
 *    - LiveKitControls: Ordered reliable-packet FIFO with bounded pending lanes.
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import {
  LIVEKIT_CONTROL_LIMITS,
  LIVEKIT_CONTROL_TOPIC,
  MAX_VOICE_CONTROL_BYTES,
  encodeVoiceControlPackets,
  VoiceControlReassembler,
  type CreateVoiceSessionResponse,
  type VoiceClientEvent,
  type VoiceErrorCode,
  type VoiceServerPayload,
} from '../../contracts/voice-wire.js';
import { voiceError } from '../session/voice-session.options.js';

const PACKET_BYTES = LIVEKIT_CONTROL_LIMITS.maxPacketBytes;
const PRIORITY: ReadonlySet<string> = new Set(['response.cancelled', 'session.error', 'session.ended']);

export class LiveKitControls {
  private rx = -1;
  private tx = 0;
  private readonly ids = new Set<string>();
  private rxCount = 0;
  private rxBytes = 0;
  private txCount = 0;
  private txBytes = 0;
  private incoming = Promise.resolve();
  private outgoing = Promise.resolve();
  private closed = false;
  private readonly reassembler: VoiceControlReassembler<'client'>;

  constructor(
    private readonly response: CreateVoiceSessionResponse,
    private readonly publish: (bytes: Uint8Array) => Promise<void>,
    private readonly dispatch: (event: VoiceClientEvent) => Promise<void>,
    private readonly fail: (code: VoiceErrorCode) => void,
  ) {
    this.reassembler = new VoiceControlReassembler('client', 'live', {
      sessionId: response.sessionId,
      connectionEpoch: response.connectionEpoch,
    });
  }

  receive(bytes: Uint8Array, identity: string | undefined, reliable: boolean, topic?: string) {
    if (this.closed || topic !== LIVEKIT_CONTROL_TOPIC) return;
    if (identity !== this.response.livekit!.participantIdentity) {
      this.fail('VOICE_BINDING_MISMATCH');
      return;
    }
    if (!reliable || bytes.byteLength > PACKET_BYTES) {
      this.fail('INVALID_VOICE_CONTROL');
      return;
    }
    if (this.rxCount >= 64 || this.rxBytes + bytes.byteLength > MAX_VOICE_CONTROL_BYTES) {
      this.fail('AUDIO_BUFFER_OVERFLOW');
      return;
    }
    const copy = Uint8Array.from(bytes);
    this.rxCount++;
    this.rxBytes += copy.byteLength;
    this.incoming = this.incoming
      .then(async () => {
        if (this.closed) return;
        const result = this.reassembler.push(copy);
        if (result.status !== 'complete') return;
        const e = result.event;
        if (e.sessionId !== this.response.sessionId) throw new Error('VOICE_BINDING_MISMATCH');
        if (e.connectionEpoch !== this.response.connectionEpoch) throw new Error('STALE_CONNECTION_EPOCH');
        if (e.sequence <= this.rx) return;
        if (e.sequence !== this.rx + 1 || this.ids.has(e.eventId)) throw new Error('VOICE_SEQUENCE_ERROR');
        if (this.ids.size === 4096) this.ids.delete(this.ids.values().next().value!);
        this.ids.add(e.eventId);
        this.rx = e.sequence;
        await this.dispatch(e);
      })
      .catch(error => this.fail(voiceError(error, 'VOICE_DELIVERY_UNKNOWN').code))
      .finally(() => {
        this.rxCount--;
        this.rxBytes -= copy.byteLength;
      });
  }

  send(payload: VoiceServerPayload) {
    if (this.closed) return;
    const json = JSON.stringify({
      protocolVersion: 1,
      sessionId: this.response.sessionId,
      connectionEpoch: this.response.connectionEpoch,
      eventId: randomUUID(),
      sequence: this.tx,
      ...payload,
    });
    this.tx++;
    let packets: Uint8Array[];
    try {
      packets = encodeVoiceControlPackets(json, 'server', 'live');
    } catch (error) {
      this.fail(voiceError(error, 'INVALID_VOICE_CONTROL').code);
      return;
    }
    const bytes = new TextEncoder().encode(json).byteLength;
    const priority = PRIORITY.has(payload.type);
    const countLimit = priority ? 64 : 63;
    const byteLimit = MAX_VOICE_CONTROL_BYTES + (priority ? PACKET_BYTES : 0);
    if (this.txCount >= countLimit || this.txBytes + bytes > byteLimit) {
      this.fail('AUDIO_BUFFER_OVERFLOW');
      return;
    }
    this.txCount++;
    this.txBytes += bytes;
    this.outgoing = this.outgoing
      .then(async () => {
        if (this.closed) return;
        for (const packet of packets) await this.publish(packet);
      })
      .catch(() => this.fail('VOICE_DELIVERY_UNKNOWN'))
      .finally(() => {
        this.txCount--;
        this.txBytes -= bytes;
      });
  }

  flush() {
    return this.outgoing;
  }

  close() {
    this.closed = true;
    this.ids.clear();
    this.reassembler.clear();
  }
}
