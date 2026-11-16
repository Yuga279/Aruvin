/**
 * ============================================================================
 * FILE: livekit-control.spec.ts
 * LOCATION: backend/test/voice/transport/livekit-control.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic checks for reliable LiveKit voice envelope shipping.
 *
 * ROLE IN PROJECT:
 *    Proves identity/session/epoch fencing, ordered replay handling, bounded
 *    queues, safe UTF-8/size rejection and P1b chunked envelope reassembly.
 *
 * KEY COMPONENTS:
 *    - fixture(): LiveKitControls with captured publish/receive/dispatch spies.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { LiveKitControls } from '../../../src/voice/transport/livekit-control.js';
import {
  INPUT_AUDIO,
  LIVEKIT_CONTROL_TOPIC,
  encodeVoiceControlPackets,
  parseVoiceControl,
  VoiceControlReassembler,
  type VoiceClientEvent,
  type VoiceServerPayload,
} from '../../../src/contracts/voice-wire.js';
import {
  createSessionResponseFixture,
  largeCanvasArtifactFixture,
} from '../../../src/contracts/testing/voice-fixtures.js';
import { agendaFixture } from '../../contracts/calendar-view.fixture.js';
import { settle } from './fixtures.js';

function fixture() {
  const response = createSessionResponseFixture('live');
  const receive = vi.fn(async (_event: VoiceClientEvent): Promise<void> => undefined);
  const publish = vi.fn(async (_bytes: Uint8Array): Promise<void> => undefined);
  const fail = vi.fn();
  const controls = new LiveKitControls(response, publish, receive, fail);
  const event = (sequence = 0) => ({
    protocolVersion: 1 as const,
    sessionId: response.sessionId,
    connectionEpoch: response.connectionEpoch,
    sequence,
    eventId: `c${sequence}`,
    type: 'session.start' as const,
    mode: 'live' as const,
    audioSettings: INPUT_AUDIO,
  });
  const push = (e: object, identity = response.livekit!.participantIdentity) =>
    controls.receive(
      new TextEncoder().encode(JSON.stringify(e)),
      identity,
      true,
      LIVEKIT_CONTROL_TOPIC,
    );
  return { response, receive, publish, fail, controls, event, push };
}

it('validates identity/session/epoch and fences ordered replays before opening a flow', async () => {
  const f = fixture();
  f.push(f.event());
  f.push(f.event());
  await settle();
  expect(f.receive).toHaveBeenCalledTimes(1);
  f.push({ ...f.event(1), connectionEpoch: 999 });
  await settle();
  expect(f.fail).toHaveBeenLastCalledWith('STALE_CONNECTION_EPOCH');
  const g = fixture();
  g.push(g.event(), 'untrusted');
  await settle();
  expect(g.fail).toHaveBeenCalledWith('VOICE_BINDING_MISMATCH');
  expect(g.receive).not.toHaveBeenCalled();
});

it('serializes valid server envelopes without forwarding backend tokens or payload logs', async () => {
  const f = fixture();
  f.controls.send({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
  f.controls.send({ type: 'session.ended', reason: 'disconnected', terminal: false });
  await settle();
  const events = f.publish.mock.calls.map(([bytes]) =>
    parseVoiceControl(new TextDecoder().decode(bytes), 'server', 'live'));
  expect(events.map(e => e.sequence)).toEqual([0, 1]);
  expect(JSON.stringify(events)).not.toContain(f.response.livekit!.participantToken);
});

it('rejects malformed UTF8, sequence gaps and oversized reliable packets before dispatch', async () => {
  const f = fixture();
  f.push(f.event(1));
  await settle();
  expect(f.fail).toHaveBeenCalledWith('VOICE_SEQUENCE_ERROR');
  const g = fixture();
  g.controls.receive(new Uint8Array([255]), g.response.livekit!.participantIdentity, true, LIVEKIT_CONTROL_TOPIC);
  await settle();
  expect(g.fail).toHaveBeenCalledWith('INVALID_VOICE_CONTROL');
  const h = fixture();
  h.controls.receive(new Uint8Array(15361), h.response.livekit!.participantIdentity, true, LIVEKIT_CONTROL_TOPIC);
  expect(h.fail).toHaveBeenCalledWith('INVALID_VOICE_CONTROL');
  expect(h.receive).not.toHaveBeenCalled();
});

it('ignores foreign topics and lossy packets', async () => {
  const f = fixture();
  f.controls.receive(new TextEncoder().encode(JSON.stringify(f.event())),
    f.response.livekit!.participantIdentity, true, 'other.topic');
  expect(f.fail).not.toHaveBeenCalled();
  f.controls.receive(new TextEncoder().encode(JSON.stringify(f.event())),
    f.response.livekit!.participantIdentity, false, LIVEKIT_CONTROL_TOPIC);
  expect(f.fail).toHaveBeenCalledWith('INVALID_VOICE_CONTROL');
  expect(f.receive).not.toHaveBeenCalled();
});

it('rejects a mismatched session and a duplicated eventId at a new sequence', async () => {
  const f = fixture();
  f.push({ ...f.event(), sessionId: 'other-session' });
  await settle();
  expect(f.fail).toHaveBeenCalledWith('VOICE_BINDING_MISMATCH');
  const g = fixture();
  g.push(g.event());
  await settle();
  g.push({ ...g.event(1), eventId: 'c0' });
  await settle();
  expect(g.fail).toHaveBeenCalledWith('VOICE_SEQUENCE_ERROR');
  expect(g.receive).toHaveBeenCalledTimes(1);
});

it('bounds queued inbound controls while dispatch is blocked', async () => {
  const f = fixture();
  let release!: () => void;
  f.receive.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  for (let i = 0; i < 65; i++) f.push(f.event(i));
  await settle();
  expect(f.fail).toHaveBeenCalledExactlyOnceWith('AUDIO_BUFFER_OVERFLOW');
  release();
  await settle();
  expect(f.receive.mock.calls.length).toBeGreaterThan(0);
  expect(f.receive.mock.calls.length).toBeLessThanOrEqual(64);
});

it('surfaces a rejected publish once and stops draining', async () => {
  const f = fixture();
  f.publish.mockRejectedValueOnce(new Error('data lane failed'));
  f.controls.send({ type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected' });
  await settle();
  expect(f.fail).toHaveBeenCalledWith('VOICE_DELIVERY_UNKNOWN');
  expect(f.publish).toHaveBeenCalledTimes(1);
});

it('chunks and reassembles a legal large canvas envelope through P1b packets', async () => {
  const f = fixture();
  const { protocolVersion: _p, sessionId: _s, connectionEpoch: _e, eventId: _i, sequence: _q,
    ...payload } = largeCanvasArtifactFixture();
  f.controls.send(payload as VoiceServerPayload);
  await settle();
  expect(f.publish.mock.calls.length).toBeGreaterThan(1);
  const reassembler = new VoiceControlReassembler('server', 'live', {
    sessionId: f.response.sessionId,
    connectionEpoch: f.response.connectionEpoch,
  });
  let complete: ReturnType<typeof reassembler.push> | undefined;
  for (const [bytes] of f.publish.mock.calls) {
    const result = reassembler.push(bytes);
    if (result.status === 'complete') complete = result;
  }
  expect(complete?.status).toBe('complete');
  if (complete?.status === 'complete') {
    expect(complete.event.type).toBe('canvas.artifact');
    if (complete.event.type === 'canvas.artifact')
      expect(complete.event.rawSource).toBe(payload.rawSource);
  }
  expect(f.fail).not.toHaveBeenCalled();
});

it('chunks a near-cap calendar frame with a paired response reference', async () => {
  const f = fixture();
  const entry = { eventId: 'event-1', summary: 'Event', start: '2026-11-11T10:00:00Z',
    end: '2026-11-11T11:00:00Z', allDay: false, timeZone: 'Etc/UTC', status: 'confirmed', htmlLink: null };
  const entries = Array.from({ length: 20 }, (_, n) => ({ ...entry, eventId: String(n), description: 'x'.repeat(400) }));
  // Grow only optional descriptions, keeping the view <=14,336 bytes.
  let view = agendaFixture({ entries });
  for (let n = 401; n < 1000; n++) {
    const candidate = { ...view, entries: entries.map(e => ({ ...e, description: 'x'.repeat(n) })) };
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > 14336) break;
    view = agendaFixture(candidate);
  }
  const event = { protocolVersion: 1 as const, sessionId: 's'.repeat(128), connectionEpoch: 1,
    eventId: 'e'.repeat(128), sequence: 0, type: 'calendar.frame' as const,
    turnId: 't'.repeat(128), attemptId: 'a'.repeat(128), responseId: 'r'.repeat(128),
    event: { type: 'calendar-view' as const, view } };
  // Use 128-byte correlations and enlarge legal JSON whitespace to exercise packet chunking.
  const json = JSON.stringify(event).replace('{', '{' + ' '.repeat(800));
  const packets = encodeVoiceControlPackets(json, 'server', 'live');
  expect(packets.length).toBeGreaterThan(1);
  const reader = new VoiceControlReassembler('server', 'live');
  let result: ReturnType<typeof reader.push> | undefined;
  for (const packet of packets) result = reader.push(packet);
  expect(result?.status).toBe('complete');
  if (result?.status === 'complete') expect(result.event).toEqual(event);
  expect(f.fail).not.toHaveBeenCalled();
});
