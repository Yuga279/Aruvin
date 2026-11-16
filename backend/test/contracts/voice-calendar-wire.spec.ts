/**
 * ============================================================================
 * FILE: voice-calendar-wire.spec.ts
 * LOCATION: backend/test/contracts/voice-calendar-wire.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validate bounded live-only voice Calendar frames and confirmation controls.
 *
 * ROLE IN PROJECT:
 *    Guards strict nested presentation validation, dictation exclusion, and
 *    correlated payloads through the existing control framing.
 *
 * KEY COMPONENTS:
 *    - Control guards: Revision-bound confirmations and forged fields.
 *    - Frame guards: Presentation-only events and bounded payloads.
 *    - Packet framing: Existing chunk reassembly round trip.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { parseVoiceControl, isVoiceServerEvent, encodeVoiceControlPackets, VoiceControlReassembler }
  from '../../src/contracts/voice-wire.js';
import { agendaFixture } from './calendar-view.fixture.js';
const envelope = { protocolVersion: 1, sessionId: 'voice-1', connectionEpoch: 1, eventId: 'e1', sequence: 1 };
const confirm = { ...envelope, type: 'calendar.confirm', proposalId: 'p1', proposalRevision: 1,
  answer: { kind: 'accept' } };

it('accepts revision-bound controls only in live mode and rejects forged authority fields', () => {
  expect(parseVoiceControl(JSON.stringify(confirm), 'client', 'live')).toEqual(confirm);
  expect(() => parseVoiceControl(JSON.stringify(confirm), 'client', 'dictation')).toThrow('INVALID_VOICE_CONTROL');
  for (const bad of [
    { ...confirm, userId: 'forged' }, { ...confirm, proposalRevision: 0 },
    { ...confirm, answer: { kind: 'accept', action: {} } },
    { ...confirm, answer: { kind: 'select', calendarId: '' } },
  ]) expect(() => parseVoiceControl(JSON.stringify(bad), 'client', 'live')).toThrow('INVALID_VOICE_CONTROL');
});

it('wraps only presentation events and rejects calendar facts in dictation', () => {
  const frame = { ...envelope, type: 'calendar.frame', turnId: 't1', attemptId: 'a1', responseId: 'r1',
    event: { type: 'calendar-view', view: agendaFixture() } };
  expect(isVoiceServerEvent(frame, 'live')).toBe(true);
  expect(isVoiceServerEvent(frame, 'dictation')).toBe(false);
  expect(isVoiceServerEvent({ ...frame, event: { type: 'delta', text: 'not a visual' } }, 'live')).toBe(false);
  expect(isVoiceServerEvent({ ...frame, event: { ...frame.event, secret: 'never' } }, 'live')).toBe(false);
  expect(isVoiceServerEvent({ ...frame, responseId: undefined }, 'live')).toBe(false);
});

it('round-trips a calendar frame through existing control packet framing', () => {
  const frame = { ...envelope, type: 'calendar.frame', turnId: 't1', attemptId: 'a1', responseId: 'r1',
    event: { type: 'calendar-view', view: agendaFixture() } };
  const packets = encodeVoiceControlPackets(JSON.stringify(frame), 'server', 'live');
  const reader = new VoiceControlReassembler('server', 'live', { sessionId: 'voice-1', connectionEpoch: 1 });
  const result = reader.push(packets[0]);
  expect(result.status).toBe('complete');
  if (result.status === 'complete') expect(result.event).toEqual(frame);
});
