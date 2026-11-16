/**
 * ============================================================================
 * FILE: config-snapshots.spec.ts
 * LOCATION: backend/test/voice/session/config-snapshots.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Prove new voice sessions capture the current frozen configuration snapshot.
 *
 * ROLE IN PROJECT:
 *    Guards P4 admission/retention so admitted sessions keep their speech
 *    snapshot while later work uses the published revision.
 *
 * KEY COMPONENTS:
 *    - revisionFixture: In-process current-config pointer without network.
 *    - Capture tests: New versus admitted snapshot identity and redaction.
 *    - Admitted LiveKit snapshot retention across reconnect and teardown.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { options, origin, request, revisionFixture, owner } from './fixtures.js';

const services: VoiceSessionService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.drain())); vi.useRealTimers(); });

it('uses current revision for new work but keeps the admitted dictation snapshot', async () => {
  const revisions = revisionFixture();
  const first = revisions.port.current()!;
  const o = { ...options(), currentConfig: revisions.port };
  const service = new VoiceSessionService(o); services.push(service);
  const a = await service.create(request, origin, owner);
  const second = revisions.make(2, s => { s.voice.limits.inputQueueMs = 800; });
  revisions.publish(second);
  const binding = service.claim(a.cookie.split(';')[0], origin, owner);
  expect(binding.configSnapshot).toBe(first);
  expect(binding.voiceConfig).toBe(first.voice);
  expect(a.response.limits.inputQueueMs).toBe(first.voice.limits.inputQueueMs);
  await service.end(a.response.sessionId);
  const b = await service.create({ ...request, idempotencyKey: 'request-0002' }, origin, owner);
  const next = service.claim(b.cookie.split(';')[0], origin, owner);
  expect(next.configSnapshot).toBe(second);
  expect(next.response.limits.inputQueueMs).toBe(800);
  expect(JSON.stringify(service.config())).not.toContain('fixture-speech');
  expect(JSON.stringify(b.response)).not.toContain('configSnapshot');
});

it.each(['dictation', 'live'] as const)('keeps an admitted %s session after that mode is disabled', async mode => {
  const revisions = revisionFixture();
  const first = revisions.port.current()!;
  const o = { ...options(), currentConfig: revisions.port };
  const service = new VoiceSessionService(o); services.push(service);
  const a = await service.create({ ...request, mode }, origin, owner);
  const claimed = service.claim(a.cookie.split(';')[0], origin, owner);
  expect(claimed.configSnapshot).toBe(first);
  revisions.publish(revisions.make(2, s => {
    s.voice.enabledModes = { dictation: mode !== 'dictation', live: mode !== 'live' };
  }));
  expect(service.config().enabledModes[mode]).toBe(false);
  const duplicate = await service.create({ ...request, mode }, origin, owner);
  expect(duplicate.response.sessionId).toBe(a.response.sessionId);
  await expect(service.create({ ...request, mode, idempotencyKey: 'request-0002' }, origin, owner))
    .rejects.toMatchObject({ code: 'VOICE_DISABLED' });
  if (mode === 'live') {
    await service.disconnected(claimed, true);
    const next = await service.create({ ...request, mode }, origin, owner);
    expect(next.response.sessionId).toBe(a.response.sessionId);
    expect(next.response.connectionEpoch).toBe(1);
    expect(next.response.limits).toEqual(first.voice.limits);
    const reclaimed = service.claim(next.cookie.split(';')[0], origin, owner);
    expect(reclaimed.configSnapshot).toBe(first);
    expect(reclaimed.voiceConfig).toBe(first.voice);
    expect(reclaimed.voiceConfig.deepgram.apiKey).toBe('fixture-speech-1');
  } else {
    await service.end(a.response.sessionId);
    expect(service.snapshot().active).toBe(0);
  }
});

it('does not fall back to static config when the current port is null', async () => {
  const revisions = revisionFixture();
  revisions.publish(null);
  const o = { ...options(), currentConfig: revisions.port };
  const service = new VoiceSessionService(o); services.push(service);
  expect(service.config().enabledModes).toEqual({ dictation: false, live: false });
  await expect(service.create(request, origin, owner)).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
  expect(o.admission).not.toHaveBeenCalled();
});

it('does not fall back to static config when Deepgram is blank', async () => {
  const revisions = revisionFixture();
  const enabled = revisions.make(2);
  revisions.publish({
    ...enabled,
    voice: { ...enabled.voice, deepgram: { ...enabled.voice.deepgram, apiKey: '' } },
  });
  const o = { ...options(), currentConfig: revisions.port };
  const service = new VoiceSessionService(o); services.push(service);
  expect(service.config().enabledModes).toEqual({ dictation: false, live: false });
  await expect(service.create(request, origin, owner)).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
  expect(o.admission).not.toHaveBeenCalled();
});

it('refuses racing admission after current capabilities change', async () => {
  const revisions = revisionFixture();
  const o = { ...options(), currentConfig: revisions.port };
  let releaseHold!: () => void;
  const held = new Promise<void>(r => { releaseHold = r; });
  const release = vi.fn(async () => undefined);
  o.admission = vi.fn(async () => { await held; return { release }; });
  const service = new VoiceSessionService(o); services.push(service);
  const rejected = expect(service.create(request, origin, owner)).rejects.toMatchObject({ code: 'VOICE_DISABLED' });
  await Promise.resolve(); await Promise.resolve();
  revisions.publish(revisions.make(2, s => {
    s.voice.enabledModes = { dictation: false, live: false };
    s.voice.quotas.identityConcurrent = 1;
    s.voice.quotas.globalConcurrent = 1;
  }));
  releaseHold();
  await rejected;
  expect(release).toHaveBeenCalledTimes(1);
  expect(o.reservations.acquire).not.toHaveBeenCalled();
});

it('captures one original snapshot rather than mixed fields during lookup', async () => {
  const revisions = revisionFixture();
  const first = revisions.port.current()!;
  const o = { ...options(), currentConfig: revisions.port };
  let releaseHold!: () => void;
  const held = new Promise<void>(r => { releaseHold = r; });
  o.sessions.get = vi.fn(async () => { await held; return { sessionId: 'conversation-1' } as never; });
  const service = new VoiceSessionService(o); services.push(service);
  const creation = service.create({ ...request, conversationId: 'conversation-1' }, origin, owner);
  await Promise.resolve(); await Promise.resolve();
  revisions.publish(revisions.make(2, s => { s.voice.limits.inputQueueMs = 800; }));
  releaseHold();
  const created = await creation;
  const binding = service.claim(created.cookie.split(';')[0], origin, owner);
  expect(created.response.limits.inputQueueMs).toBe(first.voice.limits.inputQueueMs);
  expect(binding.configSnapshot).toBe(first);
  expect(binding.voiceConfig).toBe(first.voice);
  expect(binding.voiceConfig.deepgram.apiKey).toBe('fixture-speech-1');
});

it('retains the admitted LiveKit config snapshot for reconnect and room teardown after live mode is disabled', async () => {
  const revisions = revisionFixture();
  const first = revisions.port.current()!;
  const o = { ...options(), currentConfig: revisions.port };
  const service = new VoiceSessionService(o);
  services.push(service);

  const created = await service.create({ ...request, mode: 'live' }, origin, owner);
  expect(created.response.livekit?.roomName).toBe(`aurvin-live-${created.response.sessionId}`);
  const claimed = service.claimLive(
    created.response.sessionId,
    created.response.livekit!.participantIdentity,
    created.response.livekit!.roomName,
  );
  expect(claimed.configSnapshot).toBe(first);

  const withoutLiveKit = revisions.make(2, s => {
    s.voice.enabledModes = { dictation: true, live: false };
  });
  revisions.publish({
    ...withoutLiveKit,
    voice: { ...withoutLiveKit.voice, livekit: null },
  });
  o.config.livekit = null;
  expect(service.config().enabledModes).toEqual({ dictation: true, live: false });

  await service.disconnected(claimed, true);
  const reconnected = await service.create({ ...request, mode: 'live' }, origin, owner);
  expect(reconnected.response.connectionEpoch).toBe(1);
  expect(reconnected.response.livekit?.participantIdentity).toBe(
    `server-user:${created.response.sessionId}:1`,
  );

  await service.end(created.response.sessionId);
  expect(o.roomClient.deleteRoom).toHaveBeenCalledWith(
    `aurvin-live-${created.response.sessionId}`,
  );
});
