/**
 * ============================================================================
 * FILE: live-voice-controller.test.ts
 * LOCATION: frontend/src/features/voice/state/live-voice-controller.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for LiveVoiceController over the live-only WebRTC client port.
 *
 * ROLE IN PROJECT:
 *    Verifies gesture bounds, progressive listening handshake, mute/interrupt/drain
 *    operations against the live client API, late-event fencing, draft restoration,
 *    and error/recovery behavior without any PCM capture or queue assumption.
 *
 * KEY COMPONENTS:
 *    - LiveVoiceController tests
 *    - supportsLiveVoice probe test
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { createVoiceCapabilitiesStore } from './voice-capabilities.ts';
import { liveVoiceFixture, settle, type LiveVoiceFixture } from './testing/live-voice-fixture.ts';
import { snapshotLiveDraft, supportsLiveVoice } from './useLiveVoice.ts';
import { agenda, notice, NOW, proposal } from '../../canvas/testing/calendar-view-fixtures.ts';
afterEach(() => vi.useRealTimers());

const draft = { text: 'Unsent original', start: 7, end: 15, direction: 'backward' as const };
/** How many times the native input track was actually enabled. */
const enables = (f: LiveVoiceFixture) => f.client.setInputEnabled.mock.calls.filter(([value]) => value === true).length;
const quiet = (agent: 'idle' | 'thinking' | 'speaking' = 'idle') =>
  ({ type: 'voice.state' as const, input: 'suspended' as const, agent, connection: 'connected' as const });
const resumes = (agent: 'idle' | 'thinking' | 'speaking' = 'idle') =>
  ({ type: 'voice.state' as const, input: 'listening' as const, agent, connection: 'connected' as const });

it('allocates nothing before activation or when disabled/leased; starts one live client inside the gesture', async () => {
  const f = liveVoiceFixture();
  expect(f.client.prepare).not.toHaveBeenCalled(); expect(f.http.create).not.toHaveBeenCalled();
  f.config.enabledModes.live = false;
  await f.controller.start(draft, null, f.config);
  expect(f.bindings.claimVoiceInput).not.toHaveBeenCalled();
  f.config.enabledModes.live = true; f.bindings.claimVoiceInput.mockReturnValueOnce(null);
  await f.controller.start(draft, null, f.config);
  expect(f.http.create).not.toHaveBeenCalled(); expect(f.client.prepare).not.toHaveBeenCalled();
  const starting = f.controller.start(draft, null, f.config);
  expect(f.client.prepare).toHaveBeenCalledTimes(1);
  await starting;
  expect(f.http.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', conversationId: null }), expect.any(AbortSignal));
  expect(f.client.connect).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', livekit: expect.any(Object) }));
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle(); expect(enables(f)).toBe(0);
  f.listening(); await settle(); expect(enables(f)).toBe(1);
  expect(f.draft()).toBe('Unsent original'); f.controller.exit(); await settle();
});

it('keeps one live client, waits for listening, and stops locally before interrupt control', async () => {
  const f = liveVoiceFixture();
  const starting = f.controller.start(draft, null, f.config);
  expect(f.client.prepare).toHaveBeenCalledTimes(1);
  await starting;
  expect(f.client.connect).toHaveBeenCalledWith(expect.objectContaining({ mode: 'live', livekit: expect.any(Object) }));
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  expect(f.client.setInputEnabled).not.toHaveBeenCalledWith(true);
  f.listening(); await settle();
  expect(f.client.setInputEnabled).toHaveBeenCalledWith(true);
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.client.progress.mockReturnValue({ playedSamples: 1200, playedMs: 50, proof: 'proven' });
  f.client.control.mockImplementation(payload => {
    if (payload.type === 'response.interrupt') expect(f.client.invalidate).toHaveBeenCalledWith('r1');
    return true;
  });
  f.controller.interrupt();
  expect(f.client.control).toHaveBeenCalledWith({ type: 'response.interrupt', turnId: 't1', responseId: 'r1',
    playbackPositionMs: 50, playedSamples: 1200 });
  f.controller.exit(); await settle();
  expect(f.http.end).toHaveBeenCalledTimes(1);
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
});

it('mutes input synchronously without interrupting output and resumes only after a fresh ack', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.client.control.mockClear();
  f.client.control.mockImplementation(payload => {
    if (payload.type === 'input.mute') expect(f.client.setInputEnabled).toHaveBeenLastCalledWith(false);
    return true;
  });
  const muting = f.controller.toggleMute();
  expect(f.client.setInputEnabled).toHaveBeenLastCalledWith(false);
  await muting;
  expect(f.client.control).toHaveBeenCalledWith({ type: 'input.mute' });
  expect(f.client.prepare).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot()).toMatchObject({ input: 'muted', agent: 'speaking', phase: 'active' });
  expect(f.client.invalidate).not.toHaveBeenCalled();
  const before = enables(f);
  const unmute = f.controller.toggleMute();
  await settle();
  expect(enables(f)).toBe(before);
  expect(f.client.control).toHaveBeenLastCalledWith({ type: 'input.unmute' });
  f.listening(); await unmute;
  expect(enables(f)).toBe(before + 1);
  expect(f.client.prepare).toHaveBeenCalledTimes(2);
  f.controller.exit(); await settle();
});

it('clears local audio before sending interruption and reports played rather than received samples', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.client.progress.mockReturnValue({ playedSamples: 1200, playedMs: 50, proof: 'proven' });
  f.client.control.mockImplementation(payload => {
    if (payload.type === 'response.interrupt') expect(f.client.invalidate).toHaveBeenCalledWith('r1');
    return true;
  });
  f.controller.interrupt();
  expect(f.client.invalidate).toHaveBeenCalledWith('r1');
  expect(f.client.control).toHaveBeenCalledWith({ type: 'response.interrupt', turnId: 't1', responseId: 'r1',
    playbackPositionMs: 50, playedSamples: 1200 });
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', agent: 'idle', input: 'listening' });
  f.controller.exit(); await settle();
});

it('does not return to idle on audio.end until the client reports a verified drain', async () => {
  vi.useFakeTimers(); const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.event({ type: 'audio.end', turnId: 't1', responseId: 'r1', lastAudioSequence: 0 });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.controller.getSnapshot().agent).toBe('speaking');
  f.client.progress.mockReturnValue({ playedSamples: 2400, playedMs: 100, proof: 'proven' });
  f.client.isDrained.mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(f.controller.getSnapshot().agent).toBe('idle');
  expect(f.client.control).toHaveBeenCalledWith(expect.objectContaining({ type: 'playback.progress', playedSamples: 2400 }));
  f.controller.exit(); await settle(); expect(vi.getTimerCount()).toBe(0);
});

it('restores draft/releases resources once and fences late callbacks on exit/navigation', async () => {
  const f = liveVoiceFixture(); await f.begin(); const old = f.callbacks();
  f.event({ type: 'conversation.bound', conversationId: 'chat-voice-1' });
  expect(f.bindings.bindVoiceConversation).toHaveBeenCalledWith('lease-1', 'chat-voice-1');
  f.close(); f.close(); await settle();
  expect(f.draft()).toBe('Unsent original'); expect(f.http.end).toHaveBeenCalledTimes(1);
  expect(f.client.dispose).toHaveBeenCalledTimes(1); expect(f.client.stopInput).toHaveBeenCalledTimes(1);
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot().restoreDraft).toBeNull();
  old.error?.('STT_UNAVAILABLE');
  old.audio?.({ kind: 2, flags: 0, sequence: 9, offsetMs: 0, pcm: new Uint8Array(4800) },
    { turnId: 't1', responseId: 'r1' });
  expect(f.controller.getSnapshot().phase).toBe('idle');
});

it('snapshots exact UTF-16 draft/selection without passing it into session creation', () => {
  expect(snapshotLiveDraft({ value: '🙂 Before OLD after', selectionStart: 10, selectionEnd: 13,
    selectionDirection: 'backward' } as HTMLTextAreaElement, 'stale render'))
    .toEqual({ text: '🙂 Before OLD after', start: 10, end: 13, direction: 'backward' });
  expect(snapshotLiveDraft(null, 'Unsent')).toEqual({ text: 'Unsent', start: 6, end: 6, direction: 'none' });
});

it('probes secure context, media devices and WebRTC without touching media', () => {
  const getUserMedia = () => {};
  expect(supportsLiveVoice({ isSecureContext: true, mediaDevices: { getUserMedia } }, () => {})).toBe(true);
  expect(supportsLiveVoice({ isSecureContext: false, mediaDevices: { getUserMedia } }, () => {})).toBe(false);
  expect(supportsLiveVoice({ isSecureContext: true, mediaDevices: {} }, () => {})).toBe(false);
  expect(supportsLiveVoice({ isSecureContext: true, mediaDevices: { getUserMedia } }, undefined)).toBe(false);
});

it('hiding during permission acquisition preserves the call but fences the late permission result', async () => {
  const f = liveVoiceFixture(); let grant!: () => void;
  f.client.prepare.mockImplementationOnce(() => new Promise<void>(resolve => { grant = resolve; }));
  const start = f.controller.start(draft, null, f.config);
  f.controller.suspend(); grant(); await start; await settle();
  expect(f.http.create).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().phase).toBe('suspended'); expect(f.draft()).toBe('Unsent original');
  expect(f.client.prepare).toHaveBeenCalledTimes(1);
  f.controller.exit(); await settle();
});

it('loss clears playback/input; a fresh epoch does not replay audio and requires an explicit resume', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.callbacks().lost?.();
  expect(f.client.invalidate).toHaveBeenCalled();
  expect(f.client.stopInput).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', connection: 'reconnecting' });
  const next = { ...f.response, connectionEpoch: 2 };
  f.callbacks().recovered?.(next);
  f.event({ type: 'session.ready', limits: next.limits, effectiveAudioSettings: next.effectiveAudioSettings }, 2);
  await settle(); expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', connection: 'connected', resumeRequired: true });
  await f.controller.resume();
  expect(f.client.unlock).toHaveBeenCalledTimes(1);
  expect(f.client.prepare).toHaveBeenCalledTimes(2);
  f.event(resumes(), 2);
  await settle();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', resumeRequired: false });
  expect(f.client.progress().playedSamples).toBe(0);
  f.controller.exit(); await settle();
});

it('permission/device/provider/recovery errors leave usable text and do not display arbitrary error payloads', async () => {
  for (const code of ['MICROPHONE_DENIED', 'MICROPHONE_LOST', 'STT_UNAVAILABLE', 'TTS_UNAVAILABLE', 'VOICE_RECONNECT_TIMEOUT']) {
    const f = liveVoiceFixture(); await f.begin(); f.callbacks().error?.(code); await settle();
    expect(f.controller.getSnapshot().phase).toBe('suspended'); expect(f.draft()).toBe('Unsent original');
    expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
    expect(JSON.stringify(f.controller.getSnapshot())).not.toContain(code === 'STT_UNAVAILABLE' ? 'secret' : 'HIDDEN');
    f.controller.exit(); await settle();
  }
  const f = liveVoiceFixture(); f.client.prepare.mockRejectedValueOnce(new Error('HIDDEN_SPEECH_OR_SECRET'));
  await f.controller.start(draft, null, f.config); await settle();
  expect(JSON.stringify(f.controller.getSnapshot())).not.toContain('HIDDEN_SPEECH_OR_SECRET');
  expect(f.controller.getSnapshot().phase).toBe('suspended');
  f.controller.exit(); await settle();
});

it('denied permission before admission is resumable and retries capture without losing the draft', async () => {
  const f = liveVoiceFixture();
  f.client.prepare.mockRejectedValueOnce(new Error('MICROPHONE_DENIED'));
  await f.controller.start(draft, null, f.config); await settle();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: true, resumeRequired: true });
  expect(f.controller.getSnapshot().notice).toContain('denied');
  expect(f.http.create).not.toHaveBeenCalled();
  expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
  expect(f.draft()).toBe('Unsent original');

  await f.controller.resume(); await settle();
  expect(f.client.prepare).toHaveBeenCalledTimes(2);
  expect(f.http.create).toHaveBeenCalledTimes(1);
  expect(f.client.connect).toHaveBeenCalledTimes(1);
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle(); f.listening(); await settle();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', resumeRequired: false });
  expect(f.draft()).toBe('Unsent original');
  f.controller.exit(); await settle();
});

it('preserves structured admission codes and gives distinct bounded provider notices', async () => {
  const { ApiClientError } = await import('../../../api/client.ts');
  const f = liveVoiceFixture();
  f.http.create.mockRejectedValueOnce(new ApiClientError('VOICE_QUOTA_EXHAUSTED', 'sanitized unavailable', 429, false));
  await f.controller.start(draft, null, f.config); await settle();
  expect(f.controller.getSnapshot().notice).toContain('voice limit');
  const tts = liveVoiceFixture(); await tts.begin(); tts.callbacks().error?.('TTS_UNAVAILABLE'); await settle();
  expect(tts.controller.getSnapshot().notice).toContain('Speech playback');
});

it('treats PLAYBACK_BLOCKED from the client as a resumable pause, not a transport failure', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.callbacks().error?.('PLAYBACK_BLOCKED'); await settle();
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: true });
  expect(f.controller.getSnapshot().notice).toContain('Audio is paused');
  expect(f.http.end).not.toHaveBeenCalled();
  await f.controller.resume(); f.listening(); await settle();
  expect(f.client.unlock).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot().phase).toBe('active');
  f.controller.exit(); await settle();
});

it('interrupt before any audible sample reports zero progress', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.controller.interrupt();
  expect(f.client.control).toHaveBeenCalledWith({ type: 'response.interrupt', turnId: 't1', responseId: 'r1',
    playbackPositionMs: 0, playedSamples: 0 });
  f.controller.exit(); await settle();
});

it('reports unproven playback proof without inventing samples; proven progress omits the field', async () => {
  vi.useFakeTimers(); const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.client.progress.mockReturnValue({ playedSamples: 0, playedMs: 0, proof: 'unproven' });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.client.control).toHaveBeenCalledWith(expect.objectContaining({ type: 'playback.progress', proof: 'unproven' }));
  f.controller.interrupt();
  expect(f.client.control).toHaveBeenCalledWith(expect.objectContaining({ type: 'response.interrupt', proof: 'unproven', playedSamples: 0 }));
  f.client.control.mockClear();
  f.client.progress.mockReturnValue({ playedSamples: 480, playedMs: 20, proof: 'proven' });
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r2', sampleRate: 24000, firstAudioSequence: 0 });
  await vi.advanceTimersByTimeAsync(100);
  const sent = f.client.control.mock.calls.find(([event]) => event.type === 'playback.progress');
  expect(sent?.[0]).toMatchObject({ playedSamples: 480 });
  expect(sent?.[0]).not.toHaveProperty('proof');
  f.controller.exit(); await settle(); expect(vi.getTimerCount()).toBe(0);
});

it('late successful session creation after exit is ended once and cannot connect the live client', async () => {
  const f = liveVoiceFixture(); let created!: (value: typeof f.response) => void;
  f.http.create.mockImplementationOnce(() => new Promise(resolve => { created = resolve; }));
  const starting = f.controller.start(draft, null, f.config);
  await settle(); f.controller.exit(); created(f.response); await starting; await settle();
  expect(f.http.end).toHaveBeenCalledExactlyOnceWith(f.response.sessionId);
  expect(f.client.connect).not.toHaveBeenCalled(); expect(f.controller.getSnapshot().phase).toBe('idle');
});

it('an unconfirmed remote end is operational feedback, not a claim of confirmed server cleanup', async () => {
  const f = liveVoiceFixture(); await f.begin(); f.http.end.mockRejectedValueOnce(new Error('private provider details'));
  f.controller.exit(); await settle();
  expect(f.controller.getSnapshot().phase).toBe('idle');
  expect(f.controller.getSnapshot().notice).toContain('stopped locally');
  expect(f.controller.getSnapshot().notice).not.toContain('private provider details');
});

it('a failed mute control still awaits the input teardown rejection and retains the paused call', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.client.setInputEnabled.mockRejectedValueOnce(new Error('CAPTURE_TIMEOUT')); f.client.control.mockReturnValueOnce(false);
  await expect(f.controller.toggleMute()).resolves.toBeUndefined(); await settle();
  expect(f.controller.getSnapshot().phase).toBe('suspended');
  expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
  f.controller.exit(); await settle();
});

it('adopts the initial connection limit and keeps the admitted session limit for later acknowledgements', async () => {
  vi.useFakeTimers();
  const f = liveVoiceFixture();
  f.config.limits = { ...f.config.limits, connectMs: 5000 };
  f.response.limits = { ...f.response.limits, connectMs: 9000 };
  const starting = f.controller.start(draft, null, f.config);
  expect(f.callbacks().connectMs).toBe(5000);
  await starting;
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.controller.getSnapshot().phase).toBe('active');
  await vi.advanceTimersByTimeAsync(4000);
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', errorCode: 'VOICE_CONNECT_TIMEOUT' });
  f.controller.exit(); await settle();
  expect(vi.getTimerCount()).toBe(0);
});

it('refresh does not reconfigure an active live session across lost/resume', async () => {
  const sample = liveVoiceFixture().config;
  const disabled = { ...sample, enabledModes: { dictation: false, live: false },
    limits: { ...sample.limits, inputQueueMs: 1600, outputQueueMs: 1600 } };
  const load = vi.fn().mockResolvedValueOnce(sample).mockResolvedValueOnce(disabled);
  const store = createVoiceCapabilitiesStore(load);
  await store.ensureLoaded();
  const f = liveVoiceFixture();
  f.response.limits = { ...f.response.limits, inputQueueMs: 800, outputQueueMs: 400 };
  await f.controller.start(draft, null, store.getSnapshot()!);
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  await store.refresh();
  expect(f.http.end).not.toHaveBeenCalled();
  expect(f.client.dispose).not.toHaveBeenCalled();
  expect(f.client.connect).toHaveBeenCalledTimes(1);
  f.callbacks().lost?.();
  const next = { ...f.response, connectionEpoch: 2 };
  f.callbacks().recovered?.(next);
  f.event({ type: 'session.ready', limits: next.limits, effectiveAudioSettings: next.effectiveAudioSettings }, 2);
  await settle();
  await f.controller.resume(); f.listening(); await settle();
  expect(f.client.connect).toHaveBeenCalledTimes(1);
  expect(f.callbacks().connectMs).toBe(sample.limits.connectMs);
  f.controller.exit(); await settle();
  await f.controller.start({ text: 'fresh', start: 0, end: 0, direction: 'none' }, null, store.getSnapshot()!);
  expect(f.http.create).toHaveBeenCalledTimes(1);
  expect(f.client.prepare).toHaveBeenCalledTimes(2);
});

it('reports zero input volume in live mode as a documented native-meter simplification', async () => {
  const f = liveVoiceFixture(); await f.begin();
  expect(f.controller.getVolume()).toBe(0);
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.event(quiet('speaking'));
  expect(f.controller.getVolume()).toBe(0);
  await f.controller.toggleMute();
  expect(f.controller.getVolume()).toBe(0);
  f.controller.exit(); await settle();
  expect(f.controller.getVolume()).toBe(0);
});

it('backend quiet/listening states are UI-only and never touch the native input track', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.client.control.mockClear(); f.client.setInputEnabled.mockClear(); f.client.invalidate.mockClear();
  f.event(quiet('speaking')); f.event(quiet('speaking'));
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', input: 'suspended', agent: 'speaking' });
  f.event(resumes('speaking')); f.event(resumes('speaking'));
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', input: 'listening', agent: 'speaking' });
  expect(f.client.setInputEnabled).not.toHaveBeenCalled();
  expect(f.client.control).not.toHaveBeenCalled();
  expect(f.client.invalidate).not.toHaveBeenCalled();
  expect(f.http.create).toHaveBeenCalledTimes(1);
  expect(f.http.end).not.toHaveBeenCalled();
  expect(f.bindings.bindVoiceConversation).not.toHaveBeenCalled();
  f.controller.exit(); await settle();
});

it('backend quiet events cannot interrupt playback; only response.cancelled silences output', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 });
  f.event(quiet('speaking')); f.event(resumes('speaking')); f.event(quiet('speaking'));
  expect(f.client.control.mock.calls.some(([event]) => event.type === 'response.interrupt')).toBe(false);
  expect(f.client.invalidate).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().agent).toBe('speaking');
  f.event({ type: 'response.cancelled', turnId: 't1', responseId: 'r1', lastAudioSequence: 0 });
  expect(f.client.invalidate).toHaveBeenCalledWith('r1');
  expect(f.client.control.mock.calls.some(([event]) => event.type === 'response.interrupt')).toBe(false);
  expect(f.controller.getSnapshot().agent).toBe('idle');
  f.controller.exit(); await settle();
});

it('manual mute wins over a pending automatic resume and a stale listening ack cannot enable input', async () => {
  const f = liveVoiceFixture(); await f.begin();
  f.event(quiet()); f.event(resumes());
  await f.controller.toggleMute();
  f.listening();
  expect(f.controller.getSnapshot().input).toBe('muted');
  expect(enables(f)).toBe(1);
  expect(f.client.setInputEnabled).toHaveBeenLastCalledWith(false);
  const unmute = f.controller.toggleMute(); await settle();
  expect(enables(f)).toBe(1);
  f.listening(); await unmute;
  expect(enables(f)).toBe(2);
  expect(f.client.setInputEnabled).toHaveBeenLastCalledWith(true);
  f.controller.exit(); await settle();
});

it('startup listening after ready enables the native track only on the backend ack', async () => {
  const f = liveVoiceFixture();
  await f.controller.start(draft, null, f.config);
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  expect(enables(f)).toBe(0);
  f.listening(); await settle();
  expect(enables(f)).toBe(1);
  f.controller.exit(); await settle();
});

it('stale-epoch listening cannot enable the input track', async () => {
  const f = liveVoiceFixture();
  await f.controller.start(draft, null, f.config);
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  f.event(resumes(), 0);
  await settle();
  expect(enables(f)).toBe(0);
  f.listening(); await settle();
  expect(enables(f)).toBe(1);
  f.controller.exit(); await settle();
});

it('a superseded listening ack cannot enable input after suspend', async () => {
  const f = liveVoiceFixture();
  await f.controller.start(draft, null, f.config);
  let release!: () => void;
  f.client.setInputEnabled.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  f.event({ type: 'session.ready', limits: f.response.limits, effectiveAudioSettings: f.response.effectiveAudioSettings });
  await settle();
  f.listening(); await settle();
  expect(f.client.setInputEnabled).toHaveBeenCalledTimes(1);
  f.controller.suspend();
  release(); await settle();
  expect(f.controller.getSnapshot().phase).toBe('suspended');
  f.controller.exit(); await settle();
});

it('all server failure/end variants retain the call, draft and lease without automatic paid recovery', async () => {
  for (const terminal of [false, true]) {
    for (const payload of [
      { type: 'session.error' as const, code: 'STT_UNAVAILABLE' as const, recovery: 'resume_call' as const,
        recoverable: true, terminal },
      ...(['idle', 'duration', 'quota', 'shutdown', 'error'] as const).map(reason =>
        ({ type: 'session.ended' as const, reason, terminal })),
    ]) {
      const f = liveVoiceFixture(); await f.begin(); f.event(payload); await settle()
      expect(f.controller.getSnapshot().phase).toBe('suspended')
      expect(f.controller.getSnapshot().resumeRequired).toBe(true)
      expect(f.client.stopInput).toHaveBeenCalledTimes(1)
      expect(f.http.create).toHaveBeenCalledTimes(1)
      expect(f.http.end).not.toHaveBeenCalled()
      expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled()
      expect(f.bindings.writeVoiceDraft).not.toHaveBeenCalled()
      expect(f.draft()).toBe('Unsent original')
      if (payload.type === 'session.ended' || terminal)
        expect(f.controller.getSnapshot().canResume).toBe(false)
      f.controller.exit(); await settle()
      expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1)
    }
  }
})

it('only explicit permitted Resume reuses the same session and waits for listening', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true, terminal: false })
  await settle(); expect(f.controller.getSnapshot().canResume).toBe(true)
  const resume = f.controller.resume(); await settle(); await resume
  expect(f.http.create).toHaveBeenCalledTimes(1)
  expect(f.client.connect).toHaveBeenCalledTimes(1)
  expect(f.client.control).toHaveBeenLastCalledWith({ type: 'input.unmute' })
  expect(enables(f)).toBe(1)
  f.listening(); await settle()
  expect(f.controller.getSnapshot().phase).toBe('active')
  expect(enables(f)).toBe(2)
  f.controller.exit(); await settle()
});

it('quota/duration/exhausted reconnect cannot be bypassed by Resume or a later lost callback', async () => {
  for (const code of ['VOICE_QUOTA_EXHAUSTED', 'VOICE_DURATION_LIMIT', 'VOICE_RECONNECT_TIMEOUT'] as const) {
    const f = liveVoiceFixture(); await f.begin()
    f.event({ type: 'session.error', code, recovery: 'none', recoverable: false, terminal: false })
    f.callbacks().lost?.(); await settle(); await f.controller.resume();
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: false, errorCode: code })
    expect(f.http.create).toHaveBeenCalledTimes(1)
    expect(f.client.prepare).toHaveBeenCalledTimes(1)
    expect(enables(f)).toBe(1)
    f.controller.exit(); await settle()
  }
});

it('an unsupported browser pauses with a usable notice and never admits a session', async () => {
  const f = liveVoiceFixture({ support: () => false });
  await f.controller.start(draft, null, f.config);
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'suspended', canResume: false });
  expect(f.controller.getSnapshot().notice).toContain('Voice is unavailable in this browser');
  expect(f.http.create).not.toHaveBeenCalled();
  expect(f.client.prepare).not.toHaveBeenCalled();
  expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled();
  f.controller.exit(); await settle();
});

it('permitted Resume while muted reopens server listening then remutes without enabling the track', async () => {
  const f = liveVoiceFixture(); await f.begin()
  await f.controller.toggleMute()
  const before = enables(f)
  f.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true, terminal: false })
  await settle()
  await f.controller.resume()
  expect(f.client.control).toHaveBeenLastCalledWith({ type: 'input.unmute' })
  f.listening(); await settle()
  expect(enables(f)).toBe(before)
  expect(f.client.setInputEnabled).toHaveBeenLastCalledWith(false)
  expect(f.controller.getSnapshot()).toMatchObject({ input: 'muted', phase: 'active' })
  f.controller.exit(); await settle()
});

it('Resume while prior input cleanup is pending awaits cleanup and resumes in a single click', async () => {
  const f = liveVoiceFixture(); await f.begin()
  let done!: () => void
  f.client.setInputEnabled.mockImplementationOnce(() => new Promise<void>(resolve => { done = resolve }))
  f.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true, terminal: false })
  await settle()
  const first = f.controller.resume(); await settle()
  expect(f.client.prepare).toHaveBeenCalledTimes(1)
  done(); await first
  expect(f.client.prepare).toHaveBeenCalledTimes(2)
  f.controller.exit(); await settle()
});

it('quiet beyond the old 60 plus 30 second idle window stays on call until Hang up', async () => {
  vi.useFakeTimers()
  const f = liveVoiceFixture(); await f.begin(); f.event(quiet())
  f.event({ type: 'session.warning', code: 'VOICE_IDLE_TIMEOUT', recovery: 'none', recoverable: true })
  expect(f.controller.getSnapshot().notice).toBe('Call is quiet. Audio uploads are paused automatically.')
  await vi.advanceTimersByTimeAsync(180_000)
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', input: 'suspended' })
  expect(f.controller.getSnapshot().notice).not.toContain('end soon')
  expect(f.http.end).not.toHaveBeenCalled()
  expect(f.bindings.releaseVoiceInput).not.toHaveBeenCalled()
  f.controller.exit(); f.listening(); f.frame(); await settle()
  expect(enables(f)).toBe(1)
  expect(f.client.dispose).toHaveBeenCalledTimes(1)
  expect(f.http.end).toHaveBeenCalledTimes(1)
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
});

it('hide during a pending Resume prepare cannot enable the input track', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true, terminal: false })
  await settle()
  let release!: () => void
  f.client.prepare.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const resuming = f.controller.resume()
  await settle()
  f.controller.suspend()
  release(); await resuming; f.listening(); await settle()
  expect(f.controller.getSnapshot().phase).toBe('suspended')
  expect(enables(f)).toBe(1)
  f.controller.exit(); await settle()
});

it('Hang up during permission work fences every late callback', async () => {
  const f = liveVoiceFixture()
  let grant!: () => void
  f.client.prepare.mockImplementationOnce(() => new Promise<void>(resolve => { grant = resolve }))
  const starting = f.controller.start(draft, null, f.config)
  f.controller.exit(); grant(); await starting; await settle()
  expect(f.bindings.releaseVoiceInput).toHaveBeenCalledTimes(1)
  expect(f.http.create).not.toHaveBeenCalled()
  expect(f.client.connect).not.toHaveBeenCalled()
});

it('muting the microphone does not interrupt agent playback or discard the active response', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 })
  expect(f.controller.getSnapshot().agent).toBe('speaking')
  await f.controller.toggleMute()
  expect(f.controller.getSnapshot()).toMatchObject({ input: 'muted', agent: 'speaking', phase: 'active',
    response: { turnId: 't1', responseId: 'r1' } })
  expect(f.client.control.mock.calls.some(([event]) => event.type === 'response.interrupt')).toBe(false)
  expect(f.client.invalidate).not.toHaveBeenCalled()
  f.controller.exit(); await settle()
});

it('losing the microphone mutes input but leaves the agent speaking and the call active', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'r1', sampleRate: 24000, firstAudioSequence: 0 })
  expect(f.controller.getSnapshot().agent).toBe('speaking')
  f.deviceLost(); await settle()
  expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', input: 'muted', agent: 'speaking' })
  expect(f.controller.getSnapshot().notice).toContain('Microphone unavailable')
  expect(f.client.control).toHaveBeenCalledWith({ type: 'input.mute' })
  expect(f.client.stopInput).toHaveBeenCalledTimes(1)
  expect(f.client.invalidate).not.toHaveBeenCalled()
  expect(f.client.dispose).not.toHaveBeenCalled()
  f.controller.exit(); await settle()
});

it('unmuting after microphone loss reacquires the device through the gesture prepare', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.deviceLost(); await settle()
  expect(f.controller.getSnapshot().input).toBe('muted')
  await f.controller.toggleMute()
  expect(f.client.prepare).toHaveBeenCalledTimes(2)
  expect(f.client.control).toHaveBeenLastCalledWith({ type: 'input.unmute' })
  f.listening(); await settle()
  expect(enables(f)).toBe(2)
  f.controller.exit(); await settle()
});

it('resume resets inputBusy to false when early guards prevent resuming', async () => {
  const f = liveVoiceFixture(); await f.begin()
  f.event({ type: 'session.error', code: 'STT_UNAVAILABLE', recovery: 'resume_call', recoverable: true, terminal: false })
  await settle()
  expect(f.controller.getSnapshot().phase).toBe('suspended')
  expect(f.controller.getSnapshot().inputBusy).toBe(false)
  f.client.prepare.mockImplementationOnce(async () => {
    f.controller.suspend()
  })
  await f.controller.resume()
  expect(f.controller.getSnapshot().inputBusy).toBe(false)
  f.controller.exit(); await settle()
});
it('accepts pre-audio canvas.artifact events, deduplicates by responseId+ordinal, allows ordinal gaps, and auto-opens once', async () => {
  const openCanvasArtifact = vi.fn();
  const f = liveVoiceFixture({
    bindings: {
      claimVoiceInput: vi.fn((_mode: 'live', _onClose: () => void) => 'lease-1'),
      writeVoiceDraft: vi.fn(() => true),
      releaseVoiceInput: vi.fn(),
      bindVoiceConversation: vi.fn(() => true),
      refreshSessions: vi.fn(),
      openCanvasArtifact,
    },
  });
  await f.begin();
  f.event({ type: 'conversation.bound', conversationId: 'conv-live-1' });

  // Arrives BEFORE audio.start; ordinal 0 succeeded, ordinal 1 was skipped on server, ordinal 2 succeeded
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Step One',
    rawSource: 'flowchart TD\n  A --> B',
  });
  // Exact duplicate replay of ordinal 0
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Step One',
    rawSource: 'flowchart TD\n  A --> B',
  });
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 2,
    kind: 'chart',
    subType: 'Line Graph',
    title: 'Latency',
    rawSource: 'Mon: 12\nTue: 9',
  });
  // Out-of-sequence descending ordinal 1 after ordinal 2 must be discarded
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 1,
    kind: 'chart',
    subType: 'Bar Chart',
    title: 'Late Middle',
    rawSource: 'Q1: 10\nQ2: 20',
  });

  expect(f.controller.getSnapshot().conversationId).toBe('conv-live-1');
  expect(f.controller.getSnapshot().artifacts.map((a) => `${a.responseId}::canvas::${a.ordinal}`)).toEqual([
    'resp-1::canvas::0',
    'resp-1::canvas::2',
  ]);
  expect(openCanvasArtifact).toHaveBeenCalledTimes(2);
  expect(openCanvasArtifact).toHaveBeenNthCalledWith(1, 'resp-1::canvas::0');
  expect(openCanvasArtifact).toHaveBeenNthCalledWith(2, 'resp-1::canvas::2');

  // Audio starts afterward for the same turn/response without disturbing accepted artifacts
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'resp-1', sampleRate: 24000, firstAudioSequence: 0 });
  expect(f.controller.getSnapshot().agent).toBe('speaking');
  expect(f.controller.getSnapshot().artifacts).toHaveLength(2);
  f.controller.exit();
  await settle();
});

it('discards malformed, oversized, stale-epoch, and unrenderable canvas.artifact payloads without failing the call', async () => {
  const openCanvasArtifact = vi.fn();
  const f = liveVoiceFixture({
    bindings: {
      claimVoiceInput: vi.fn(() => 'lease-1'),
      writeVoiceDraft: vi.fn(() => true),
      releaseVoiceInput: vi.fn(),
      bindVoiceConversation: vi.fn(() => true),
      refreshSessions: vi.fn(),
      openCanvasArtifact,
    },
  });
  await f.begin();

  const base = {
    type: 'canvas.artifact' as const,
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Valid',
    rawSource: 'flowchart TD\n  A --> B',
  };

  // Wrong epoch
  f.event(base, f.response.connectionEpoch + 1);
  // Malformed ordinal, oversized title, oversized rawSource, empty Mermaid nodes, empty SVG
  for (const invalid of [
    { ...base, ordinal: 3 },
    { ...base, ordinal: -1 },
    { ...base, turnId: 'bad turn id' },
    { ...base, title: 'T'.repeat(121) },
    { ...base, subType: 'S'.repeat(49) },
    { ...base, rawSource: 'X'.repeat(8193) },
    { ...base, rawSource: 'flowchart TD' },
    { ...base, kind: 'svg' as const, subType: 'SVG Visual', rawSource: '<svg><script>alert(1)</script></svg>' },
  ]) {
    f.event(invalid);
  }

  expect(f.controller.getSnapshot().phase).toBe('active');
  expect(f.controller.getSnapshot().errorCode).toBeNull();
  expect(f.controller.getSnapshot().artifacts).toEqual([]);
  expect(openCanvasArtifact).not.toHaveBeenCalled();

  // Call stays completely healthy and accepts a subsequent valid artifact
  f.event(base);
  expect(f.controller.getSnapshot().artifacts).toHaveLength(1);
  expect(openCanvasArtifact).toHaveBeenCalledExactlyOnceWith('resp-1::canvas::0');
  f.controller.exit();
  await settle();
});

it('retains accepted artifacts on barge-in and response.cancelled while rejecting cancelled in-flight and retired-turn artifacts', async () => {
  const f = liveVoiceFixture();
  await f.begin();

  // Turn 1: ordinal 0 accepted before audio, then audio starts, then user interrupts (barge-in)
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Retained On Barge-In',
    rawSource: 'flowchart TD\n  Start --> Keep',
  });
  f.event({ type: 'audio.start', turnId: 't1', responseId: 'resp-1', sampleRate: 24000, firstAudioSequence: 0 });
  f.controller.interrupt();

  // Late artifact for interrupted resp-1 must be rejected
  f.event({
    type: 'canvas.artifact',
    turnId: 't1',
    responseId: 'resp-1',
    ordinal: 1,
    kind: 'mermaid',
    subType: 'Flowchart',
    title: 'Cancelled Late',
    rawSource: 'flowchart TD\n  Late --> Drop',
  });
  expect(f.controller.getSnapshot().artifacts.map((a) => a.title)).toEqual(['Retained On Barge-In']);

  // Turn 2: pre-audio response.cancelled fences late pre-audio artifact and late audio.start
  f.event({
    type: 'canvas.artifact',
    turnId: 't2',
    responseId: 'resp-2',
    ordinal: 0,
    kind: 'chart',
    subType: 'Bar Chart',
    title: 'Turn 2 Kept',
    rawSource: 'A: 10\nB: 20',
  });
  f.event({ type: 'response.cancelled', turnId: 't2', responseId: 'resp-2', lastAudioSequence: null });
  f.event({
    type: 'canvas.artifact',
    turnId: 't2',
    responseId: 'resp-2',
    ordinal: 1,
    kind: 'chart',
    subType: 'Bar Chart',
    title: 'Turn 2 Dropped After Cancel',
    rawSource: 'C: 30\nD: 40',
  });

  // Turn 3 retires prior turns; late Turn 2 or Turn 1 events stay rejected
  f.event({
    type: 'canvas.artifact',
    turnId: 't3',
    responseId: 'resp-3',
    ordinal: 0,
    kind: 'chart',
    subType: 'Pie Chart',
    title: 'Turn 3 Fresh',
    rawSource: '{"type":"pie","labels":["X","Y"],"datasets":[{"label":"P","data":[70,30]}]}',
  });

  expect(f.controller.getSnapshot().artifacts.map((a) => a.title)).toEqual([
    'Retained On Barge-In',
    'Turn 2 Kept',
    'Turn 3 Fresh',
  ]);
  f.controller.exit();
  await settle();
});

it('forwards optional turnId and save metadata from conversation.bound while keeping 2-arg binding when omitted', async () => {
  const f = liveVoiceFixture();
  await f.begin();
  const save = { state: 'pending' as const, epoch: 'epoch-1', version: 1, durableVersion: 0 };
  f.event({ type: 'conversation.bound', conversationId: 'conv-save-1', turnId: 'vturn-1', save });
  expect(f.bindings.bindVoiceConversation).toHaveBeenLastCalledWith('lease-1', 'conv-save-1', {
    turnId: 'vturn-1',
    save,
  });
  f.controller.exit();
  await settle();
});

it('sends one revision-bound confirmation and leaves microphone/playback unchanged',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const f=liveVoiceFixture();
  try {
    await f.begin();
    f.event({type:'conversation.bound',conversationId:'chat-1'});
    f.event({type:'calendar.frame',turnId:'t1',attemptId:'a1',responseId:'r1',event:{type:'calendar-view',view:proposal()}});
    f.client.control.mockClear();f.client.setInputEnabled.mockClear();f.client.invalidate.mockClear();
    expect(f.controller.confirmCalendar('proposal-1',2,{kind:'accept'})).toBe(true);
    expect(f.controller.confirmCalendar('proposal-1',2,{kind:'accept'})).toBe(false);
    expect(f.client.control).toHaveBeenCalledExactlyOnceWith({type:'calendar.confirm',proposalId:'proposal-1',
      proposalRevision:2,answer:{kind:'accept'}});
    expect(f.client.setInputEnabled).not.toHaveBeenCalled();
    expect(f.client.invalidate).not.toHaveBeenCalled();
    expect(f.http.end).not.toHaveBeenCalled();
  } finally {f.controller.exit();await settle();vi.useRealTimers();}
});

it('keeps audio operational when Calendar presentation throws and ignores old epochs',async()=>{
  const f=liveVoiceFixture();await f.begin();f.event({type:'conversation.bound',conversationId:'chat-1'});
  const off=f.controller.subscribe(()=>{throw new Error('visual subscriber failed');});
  expect(()=>f.event({type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',
    event:{type:'calendar-view',view:agenda()}})).not.toThrow();
  off();
  f.event({type:'audio.start',turnId:'t',responseId:'r',sampleRate:24000,firstAudioSequence:0});
  expect(f.controller.getSnapshot()).toMatchObject({phase:'active',agent:'speaking'});
  expect(f.client.stopInput).not.toHaveBeenCalled();
  const before=f.controller.getSnapshot().calendarWorkspaces;
  f.event({type:'calendar.frame',turnId:'old',attemptId:'old',responseId:'old',event:{type:'calendar-view',view:notice()}},0);
  expect(f.controller.getSnapshot().calendarWorkspaces).toBe(before);
  f.controller.exit();await settle();
});

it.each(['expired','revision','navigation','thinking','lost','candidate'] as const)
  ('rejects %s confirmation without sending a control',async kind=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);
    const f=liveVoiceFixture();
    try {
      await f.begin();f.event({type:'conversation.bound',conversationId:'chat-1'});
      f.event({type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',event:{type:'calendar-view',view:proposal()}});
      if (kind === 'expired') vi.setSystemTime(NOW+600_000);
      if (kind === 'navigation') f.selectConversation('other');
      if (kind === 'thinking') f.event({type:'voice.state',input:'listening',agent:'thinking',connection:'connected'});
      if (kind === 'lost') f.callbacks().lost?.();
      f.client.control.mockClear();
      expect(f.controller.confirmCalendar('proposal-1',kind === 'revision' ? 1 : 2,
        kind === 'candidate' ? {kind:'select',calendarId:'unlisted@example.com'} : {kind:'accept'})).toBe(false);
      expect(f.client.control).not.toHaveBeenCalled();
    } finally {f.controller.exit();await settle();vi.useRealTimers();}
  });

it('does not await an unfinished visual subscription before subsequent audio events',async()=>{
  const f=liveVoiceFixture();await f.begin();f.event({type:'conversation.bound',conversationId:'chat-1'});
  const off=f.controller.subscribe(()=>new Promise<void>(()=>{}));
  f.event({type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',event:{type:'calendar-view',view:agenda()}});
  f.event({type:'audio.start',turnId:'t',responseId:'r',sampleRate:24000,firstAudioSequence:0});
  expect(f.controller.getSnapshot().agent).toBe('speaking');
  expect(f.client.stopInput).not.toHaveBeenCalled();off();f.controller.exit();await settle();
});

it.each([false,'throw'] as const)('keeps uncertain confirmation delivery fenced on %s',async result=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const f=liveVoiceFixture();
  try {
    await f.begin();f.event({type:'conversation.bound',conversationId:'chat-1'});
    f.event({type:'calendar.frame',turnId:'t',attemptId:'a',responseId:'r',event:{type:'calendar-view',view:proposal()}});
    f.client.control.mockImplementationOnce(()=>{if (result === 'throw') throw new Error('send');return false;});
    expect(f.controller.confirmCalendar('proposal-1',2,{kind:'accept'})).toBe(false);
    expect(f.controller.confirmCalendar('proposal-1',2,{kind:'accept'})).toBe(false);
    expect(f.controller.getSnapshot().calendarWorkspaces[0]).toMatchObject({pending:true,interactive:false});
    expect(f.controller.getSnapshot().phase).toBe('active');
  } finally {f.controller.exit();await settle();vi.useRealTimers();}
});
