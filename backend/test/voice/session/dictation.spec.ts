/**
 * ============================================================================
 * FILE: dictation.spec.ts
 * LOCATION: backend/test/voice/session/dictation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for DictationFlow speech-to-text handling and lifecycle.
 *
 * ROLE IN PROJECT:
 *    Verifies that dictation sessions stream audio into STT, correctly propagate
 *    partial and final transcript events, handle Stop/Cancel fencing, timeouts,
 *    and never trigger agent execution.
 *
 * KEY COMPONENTS:
 *    - DictationFlow lifecycle tests (partials, finals, stop, cancel, timeouts).
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { DictationFlow } from '../../../src/voice/session/dictation-flow.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import type { VoiceSink } from '../../../src/voice/session/voice-session.options.js';
import type { VoiceClientEvent } from '../../../src/contracts/voice-wire.js';
import { options, origin, request, fakeStt, owner } from './fixtures.js';
import { settle } from '../transport/fixtures.js';

const services: VoiceSessionService[] = [], flows: DictationFlow[] = [];
afterEach(async () => {
  await Promise.all(flows.splice(0).map(f => f.close()));
  await Promise.all(services.splice(0).map(s => s.drain()));
  vi.useRealTimers();
});

async function fixture() {
  const o = options(), s = new VoiceSessionService(o);
  services.push(s);
  const created = await s.create(request, origin, owner);
  const context = s.claim(created.cookie.split(';')[0], origin, owner);
  const stt = fakeStt();
  const sink: VoiceSink = { outputSamples: () => 0, event: vi.fn(), audio: vi.fn(), invalidate: vi.fn(), finish: vi.fn() };
  const flow = await DictationFlow.open(context, sink, new AbortController().signal, stt.port, o.usage);
  flow.start();
  flows.push(flow);
  const control = (type: 'dictation.stop' | 'dictation.cancel'): VoiceClientEvent => ({
    protocolVersion: 1,
    sessionId: context.response.sessionId,
    connectionEpoch: 0,
    eventId: type,
    sequence: 1,
    type
  });
  return { o, context, stt, sink, flow, control };
}

it('revises partials, commits finals once, and a pause never submits a turn', async () => {
  const f = await fixture();
  await f.flow.input(new Uint8Array(2560));
  f.stt.events.push({ type: 'partial', segmentId: 'seg1', text: 'hello' });
  f.stt.events.push({ type: 'partial', segmentId: 'seg1', text: 'hello Aurvin' });
  f.stt.events.push({ type: 'final', segmentId: 'seg1', text: 'Hello Aurvin.' });
  f.stt.events.push({ type: 'final', segmentId: 'seg1', text: 'Hello Aurvin.' });
  await settle();
  expect(vi.mocked(f.sink.event).mock.calls.map(([e]) => e.type)).toEqual([
    'dictation.partial', 'dictation.partial', 'dictation.final']);
  expect(f.stt.connection.finalize).not.toHaveBeenCalled();
  expect(f.o.reservations.acquire).not.toHaveBeenCalled();
  expect(f.sink.finish).not.toHaveBeenCalled();
});

it('Stop accepts remaining finals then completes, never by finalize promise alone', async () => {
  const f = await fixture();
  await f.flow.control(f.control('dictation.stop'));
  await settle();
  expect(f.sink.finish).not.toHaveBeenCalled();
  f.stt.events.push({ type: 'final', segmentId: 'tail', text: 'Not Friday.' });
  f.stt.events.push({ type: 'finalized', unfinalizedTail: false });
  await settle();
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
  expect(f.sink.finish).toHaveBeenCalledWith('completed');
});

it('does not confirm dictation completion when terminal accounting drain fails', async () => {
  const f = await fixture();
  flows.pop(); // This intentionally rejected close is asserted below, not retried in teardown.
  const events = vi.spyOn(f.sink, 'event'), finish = vi.spyOn(f.sink, 'finish');
  vi.spyOn(f.stt.connection, 'close').mockRejectedValue(new Error('accounting unavailable'));
  await f.flow.control(f.control('dictation.stop'));
  f.stt.events.push({ type: 'finalized', unfinalizedTail: false });
  await settle();
  expect(events).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dictation.complete' }));
  expect(finish).toHaveBeenCalledWith('error');
  await expect(f.flow.close()).rejects.toThrow('accounting unavailable');
});

it('Cancel during finalization closes once and fences late results', async () => {
  const f = await fixture();
  await f.flow.control(f.control('dictation.stop'));
  await f.flow.control(f.control('dictation.cancel'));
  await f.flow.close();
  f.stt.events.push({ type: 'final', segmentId: 'late', text: 'must not insert' });
  await settle();
  expect(f.stt.connection.close).toHaveBeenCalledTimes(1);
  expect(f.sink.event).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'dictation.final' }));
  expect(f.sink.finish).toHaveBeenCalledWith('cancelled');
});

it('two-second timeout preserves finals and signals an unfinalized tail', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  f.stt.events.push({ type: 'final', segmentId: 'one', text: 'Keep this.' });
  f.stt.events.push({ type: 'partial', segmentId: 'two', text: 'uncertain' });
  await settle();
  await f.flow.control(f.control('dictation.stop'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'dictation.complete', finalization: 'timeout', unfinalizedTail: true });
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'dictation.final', segmentId: 'one', text: 'Keep this.' });
});

it('a provider timeout after all speech finalized does not invent a lost tail', async () => {
  const f = await fixture();
  await f.flow.input(new Uint8Array(2560));
  f.stt.events.push({ type: 'final', segmentId: 'one', text: 'Complete.' });
  await settle();
  await f.flow.control(f.control('dictation.stop'));
  f.stt.events.push({ type: 'finalized', unfinalizedTail: false });
  await settle();
  expect(f.sink.event).toHaveBeenCalledWith({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
});
