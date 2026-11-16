/**
 * ============================================================================
 * FILE: dictation-controller.test.ts
 * LOCATION: frontend/src/features/voice/dictation/dictation-controller.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for DictationController lifecycle, state transitions, and isolation.
 *
 * ROLE IN PROJECT:
 *    Verifies microphone acquisition on ready, revision handling without chat submits,
 *    cancellation snapshots, and fence behavior against stale callbacks.
 *
 * KEY COMPONENTS:
 *    - DictationController test suite
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { dictationFixture, settle } from './testing/dictation-fixture.ts';
import { snapshotDraft } from './dictation-draft.ts';
import { restoreComposerSelection } from './useDictation.ts';

afterEach(() => vi.useRealTimers());

it('restores selection direction after React has committed the controlled draft', () => {
  const element = { value: 'Before OLD after', focus: vi.fn(), setSelectionRange: vi.fn() };
  restoreComposerSelection(element as unknown as HTMLTextAreaElement,
    { start: 7, end: 10, direction: 'backward' });
  expect(element.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(element.setSelectionRange).toHaveBeenCalledWith(7, 10, 'backward');
  restoreComposerSelection(null, { start: 7, end: 10, direction: 'none' });
});

it('does not acquire a microphone before activation; unmutes only after ready', async () => {
  const f = dictationFixture();
  expect(f.capture.start).not.toHaveBeenCalled();
  await f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.capture.start).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot().phase).toBe('connecting');
  expect(f.capture.setMuted).not.toHaveBeenCalled();
  expect(f.http.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dictation',
    conversationId: null, locale: 'en-US' }), expect.any(AbortSignal));
  f.event({ type: 'session.ready', limits: f.response.limits,
    effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  expect(f.capture.setMuted).toHaveBeenCalledWith(false, f.response.limits.inputQueueMs);
  expect(f.controller.getSnapshot().phase).toBe('recording');
  f.controller.cancel();
});

it('writes revisions into the existing draft without submitting a chat turn', async () => {
  const f = dictationFixture(); await f.begin();
  f.event({ type: 'dictation.partial', segmentId: 'one', text: 'hello' });
  f.event({ type: 'dictation.partial', segmentId: 'one', text: 'hello Aurvin' });
  expect(f.text()).toBe('Before hello Aurvin after');
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Hello Aurvin.' });
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Hello Aurvin.' });
  expect(f.text()).toBe('Before Hello Aurvin. after');
  expect(f.client.control).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().phase).toBe('recording');
  expect(Object.keys(f.http)).toEqual(['create', 'end']);
  f.controller.cancel();
});

it('Cancel restores the snapshot and a previous recording cannot write into a later one', async () => {
  const f = dictationFixture(); await f.begin(); const old = f.callbacks();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'new' });
  f.controller.cancel();
  expect(f.text()).toBe('Before OLD after');
  expect(f.controller.getSnapshot().selection).toEqual({ start: 7, end: 10, direction: 'backward' });
  await f.begin();
  old.event?.({ protocolVersion: 1, sessionId: f.response.sessionId, connectionEpoch: 1,
    eventId: 'late', sequence: 99, type: 'dictation.final', segmentId: 'late', text: 'bad' });
  expect(f.text()).toBe('Before OLD after');
  f.controller.cancel();
});

it('disabled dictation or an occupied composer allocates no microphone/session', async () => {
  const f = dictationFixture(); f.config.enabledModes.dictation = false;
  await f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.bindings.claimVoiceInput).not.toHaveBeenCalled();
  f.config.enabledModes.dictation = true;
  f.bindings.claimVoiceInput.mockReturnValueOnce(null);
  await f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.capture.start).not.toHaveBeenCalled();
  expect(f.http.create).not.toHaveBeenCalled();
});

it('Stop drains the terminal input before its control and stays locked for tail finals', async () => {
  const f = dictationFixture(); await f.begin();
  const order: string[] = [];
  f.client.sendInput.mockImplementation(() => { order.push('tail'); return true; });
  f.client.control.mockImplementation(() => { order.push('stop'); return true; });
  f.capture.stop.mockImplementationOnce(async drain => {
    if (drain) f.frame(new Uint8Array(640), 1);
  });
  await f.controller.stop();
  expect(f.capture.stop).toHaveBeenCalledWith(true);
  expect(order).toEqual(['tail', 'stop']);
  expect(f.controller.getSnapshot().phase).toBe('finalizing');
  expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
  f.event({ type: 'dictation.final', segmentId: 'tail', text: 'Not Friday.' });
  f.event({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
  expect(f.text()).toBe('Before Not Friday. after');
  expect(f.controller.getSnapshot().phase).toBe('draft_ready');
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
  expect(f.client.dispose).toHaveBeenCalledTimes(1);
});

it('Stop has a two-second total watchdog and never commits an uncertain interim tail', async () => {
  vi.useFakeTimers(); const f = dictationFixture(); await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Keep this.' });
  f.event({ type: 'dictation.partial', segmentId: 'two', text: 'uncertain tail' });
  await f.controller.stop();
  await vi.advanceTimersByTimeAsync(1999);
  expect(f.controller.getSnapshot().phase).toBe('finalizing');
  await vi.advanceTimersByTimeAsync(1);
  expect(f.text()).toBe('Before Keep this. after');
  expect(f.controller.getSnapshot().notice).toContain('Some speech may be missing');
  expect(f.controller.getSnapshot().phase).toBe('draft_ready');
  f.event({ type: 'dictation.final', segmentId: 'late', text: 'must not appear' });
  expect(f.text()).toBe('Before Keep this. after');
  expect(vi.getTimerCount()).toBe(0);
});

it('Cancel wins while the drain is pending and drops completion from the cancelled run', async () => {
  vi.useFakeTimers(); const f = dictationFixture(); await f.begin();
  let drained!: () => void;
  f.capture.stop.mockImplementationOnce(() => new Promise<void>(resolve => { drained = resolve; }));
  const stopping = f.controller.stop();
  f.controller.cancel();
  expect(f.text()).toBe('Before OLD after');
  f.event({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false });
  drained(); await stopping;
  expect(f.client.control).toHaveBeenCalledWith({ type: 'dictation.cancel' });
  expect(f.client.control).not.toHaveBeenCalledWith({ type: 'dictation.stop' });
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('disconnect keeps finals, discards interim and requires a fresh explicit gesture', async () => {
  const f = dictationFixture(); await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Committed.' });
  f.event({ type: 'dictation.partial', segmentId: 'two', text: 'not committed' });
  f.callbacks().lost?.();
  expect(f.text()).toBe('Before Committed. after');
  expect(f.capture.stop).toHaveBeenCalledWith(false);
  expect(f.controller.getSnapshot().selection).toBeNull();
  expect(f.controller.getSnapshot().notice).toContain('record again');
  expect(f.http.create).toHaveBeenCalledTimes(1);
  await f.controller.start(snapshotDraft(f.text(), 17, 17), null, f.config);
  expect(f.http.create).toHaveBeenCalledTimes(2);
  const keys = f.http.create.mock.calls.map(([request]) => request.idempotencyKey);
  expect(keys[0]).not.toBe(keys[1]);
  f.controller.cancel();
});

it('permission denial returns an unchanged editable draft and allocates no voice session', async () => {
  const f = dictationFixture();
  f.capture.start.mockRejectedValueOnce(new Error('MICROPHONE_DENIED'));
  await f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.text()).toBe('Before OLD after');
  expect(f.http.create).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().notice).toContain('Microphone access was denied');
  expect(f.controller.getSnapshot().phase).toBe('draft_ready');
});

it('stops at the negotiated duration and empty completion does not delete selected text', async () => {
  vi.useFakeTimers(); const f = dictationFixture();
  f.response.limits.dictationMaxMs = 3000;
  await f.begin();
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.client.control).toHaveBeenCalledWith({ type: 'dictation.stop' });
  f.event({ type: 'dictation.complete', finalization: 'empty', unfinalizedTail: false });
  expect(f.text()).toBe('Before OLD after');
  expect(f.controller.getSnapshot().notice).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('a cancelled permission acquisition cannot create a session when it resolves late', async () => {
  const f = dictationFixture(); let grant!: () => void;
  f.capture.start.mockImplementationOnce(() => new Promise<void>(resolve => { grant = resolve; }));
  const starting = f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  expect(f.controller.getSnapshot().phase).toBe('requesting_permission');
  f.controller.cancel(); grant(); await starting;
  expect(f.http.create).not.toHaveBeenCalled();
  expect(f.capture.stop).toHaveBeenCalledWith(false);
  expect(f.text()).toBe('Before OLD after');
});

it('an HTTP response arriving after Cancel is ended but never connected', async () => {
  const f = dictationFixture();
  let respond!: (value: typeof f.response) => void;
  f.http.create.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
  const starting = f.controller.start(snapshotDraft('Before OLD after', 7, 10), null, f.config);
  await settle(); f.controller.cancel(); respond(f.response); await starting;
  expect(f.client.connect).not.toHaveBeenCalled();
  expect(f.http.end).toHaveBeenCalledWith(f.response.sessionId);
});

it('server timeout feedback removes interim but preserves every committed word', async () => {
  const f = dictationFixture(); await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'Not 13. ID A-7.' });
  f.event({ type: 'dictation.partial', segmentId: 'two', text: 'wrong tail' });
  await f.controller.stop();
  f.event({ type: 'dictation.complete', finalization: 'timeout', unfinalizedTail: true });
  expect(f.text()).toBe('Before Not 13. ID A-7. after');
  expect(f.controller.getSnapshot().notice).toContain('Review your draft');
});

it('overflow releases capture and keeps the previous final, with an explicit limit notice', async () => {
  const f = dictationFixture('x'.repeat(31_996), 31_996, 31_996); await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'OK' });
  f.event({ type: 'dictation.partial', segmentId: 'two', text: 'too long' });
  expect(f.text()).toBe('x'.repeat(31_996) + 'OK');
  expect(f.controller.getSnapshot().notice).toContain('message limit');
  expect(f.client.dispose).toHaveBeenCalledTimes(1);
  expect(f.capture.stop).toHaveBeenCalledWith(false);
});

it('refresh does not change active duration or accepted draft segments', async () => {
  vi.useFakeTimers();
  const f = dictationFixture();
  f.response.limits = { ...f.response.limits, dictationMaxMs: 3000, finalizationMs: 2000 };
  await f.begin();
  f.event({ type: 'dictation.final', segmentId: 'one', text: 'kept' });
  const newer = { ...f.config, enabledModes: { dictation: false, live: false },
    limits: { ...f.config.limits, dictationMaxMs: 500, finalizationMs: 200, inputQueueMs: 1600 } };
  await f.controller.start(snapshotDraft(f.text(), 0, 0), null, newer);
  expect(f.http.create).toHaveBeenCalledTimes(1);
  expect(f.capture.setMuted).toHaveBeenCalledWith(false, f.response.limits.inputQueueMs);
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.client.control).toHaveBeenCalledWith({ type: 'dictation.stop' });
  expect(f.text()).toContain('kept');
});


