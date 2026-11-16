/**
 * ============================================================================
 * FILE: voice-runner.spec.ts
 * LOCATION: backend/test/benchmark/voice-runner.spec.ts
 * PURPOSE: Exercise the real benchmark WebSocket client against local fixtures.
 * ROLE IN PROJECT: Verifies audio pacing/progress/cleanup without speech providers.
 * KEY COMPONENTS: runVoice headless receipt and simulated-playback contract.
 * ============================================================================
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it } from 'vitest';
import { benchmarkConfigSchema } from '../../src/benchmark/runner.js';
import { runVoice } from '../../src/benchmark/voice-runner.js';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO } from '../../src/contracts/voice-wire.js';
import { encodeVoiceAudio, decodeVoiceAudio } from '../../src/contracts/voice-audio.js';

it('paces PCM, acknowledges simulated playback, and releases a real local socket/session', async () => {
  let deleted = false, acknowledged = false;
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'DELETE') { deleted = true; res.statusCode = 204; res.end(); return; }
    res.statusCode = 201; res.setHeader('Set-Cookie', 'aurvin-voice=fixture; HttpOnly');
    res.end(JSON.stringify({ protocolVersion: 1, sessionId: 'vs', conversationId: null, mode: 'live',
      connectionEpoch: 0, websocketUrl: '/api/voice', expiresAt: new Date(Date.now() + 30000).toISOString(),
      effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO }, limits: DEFAULT_VOICE_LIMITS }));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', socket => {
    let sequence = 0, replied = false;
    const send = (payload: unknown) => socket.send(JSON.stringify({ protocolVersion: 1,
      sessionId: 'vs', connectionEpoch: 0, eventId: `e-${sequence}`, sequence: sequence++, ...payload as object }));
    socket.on('message', (data, binary) => {
      if (!Buffer.isBuffer(data)) throw new Error('fixture-buffer-required');
      if (binary) {
        expect(decodeVoiceAudio(new Uint8Array(data)).kind).toBe(1);
        if (replied) return;
        replied = true;
        setTimeout(() => {
          send({ type: 'voice.state', input: 'listening', agent: 'thinking', connection: 'connected' });
          send({ type: 'conversation.bound', conversationId: 'conversation' });
          send({ type: 'audio.start', turnId: 'turn', responseId: 'response', sampleRate: 24000, firstAudioSequence: 0 });
          socket.send(encodeVoiceAudio({ kind: 2, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(480) }));
        }, 30);
        return;
      }
      const event = JSON.parse(data.toString()) as { type: string; playedSamples?: number };
      if (event.type === 'session.start') send({ type: 'session.ready', limits: DEFAULT_VOICE_LIMITS,
        effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO } });
      if (event.type === 'playback.progress' && event.playedSamples === 240 && !acknowledged) {
        acknowledged = true;
        send({ type: 'audio.end', turnId: 'turn', responseId: 'response', lastAudioSequence: 0 });
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture-address');
  try {
    const config = benchmarkConfigSchema.parse({ baseUrl: `http://127.0.0.1:${address.port}/api`,
      start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z', timeZone: 'Etc/UTC', speechEndMs: 10, timeoutMs: 2000 });
    const result = await runVoice(config, new Uint8Array(64000), undefined, async pending => {
      expect(pending.completed).toBe(true);
      expect(deleted).toBe(false); // Must not close/cancel before durable confirmation.
      return true;
    });
    expect(result).toMatchObject({ outcome: 'completed', completed: true, turnId: 'turn', audioDurationMs: 10 });
    expect(result.speechEndToFirstAudioMs).toBeGreaterThanOrEqual(0);
    expect(result.firstTextMs).toBeNull();
    expect(deleted).toBe(true); expect(acknowledged).toBe(true);
  } finally {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>(yes => sockets.close(() => yes()));
    await new Promise<void>(yes => server.close(() => yes()));
  }
});

it('rejects malformed or oversized synthetic audio before opening paid resources', async () => {
  const config = benchmarkConfigSchema.parse({ start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z', timeZone: 'Etc/UTC', speechEndMs: 10 });
  await expect(runVoice(config, new Uint8Array(1))).rejects.toThrow('INVALID_BENCHMARK_PCM');
});

async function mismatchServer(livekit: boolean) {
  let deleted = false;
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'DELETE') { deleted = true; res.statusCode = 204; res.end(); return; }
    res.statusCode = 201; res.setHeader('Set-Cookie', 'aurvin-voice=fixture; HttpOnly');
    res.end(JSON.stringify({ protocolVersion: 1, sessionId: 'vs', conversationId: null, mode: 'live',
      connectionEpoch: 0, websocketUrl: '/api/voice', expiresAt: new Date(Date.now() + 30000).toISOString(),
      ...(livekit ? { livekit: { url: 'ws://127.0.0.1:7880', roomName: 'aurvin-live-vs',
        participantIdentity: 'aurvin-dev-user:vs:0',
        participantToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2' } } : {}),
      effectiveAudioSettings: { input: INPUT_AUDIO, output: OUTPUT_AUDIO }, limits: DEFAULT_VOICE_LIMITS }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture-address');
  return { server, deleted: () => deleted, port: address.port };
}

it('fails a declared WebRTC run on a legacy descriptor without opening a socket', async () => {
  const fixture = await mismatchServer(false);
  try {
    const config = benchmarkConfigSchema.parse({ baseUrl: `http://127.0.0.1:${fixture.port}/api`,
      transport: 'webrtc', start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z',
      timeZone: 'Etc/UTC', speechEndMs: 10, timeoutMs: 2000 });
    const result = await runVoice(config, new Uint8Array(64000));
    expect(result).toMatchObject({ outcome: 'failed', failureCode: 'BENCHMARK_TRANSPORT_MISMATCH',
      voiceSessionId: 'vs' });
    expect(result.firstAudioMs).toBeNull();
    expect(fixture.deleted()).toBe(true);
  } finally { await new Promise<void>(yes => fixture.server.close(() => yes())); }
});

it('never silently falls back to WebSocket when a legacy config meets a LiveKit descriptor', async () => {
  const fixture = await mismatchServer(true);
  try {
    const config = benchmarkConfigSchema.parse({ baseUrl: `http://127.0.0.1:${fixture.port}/api`,
      start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z',
      timeZone: 'Etc/UTC', speechEndMs: 10, timeoutMs: 2000 });
    const result = await runVoice(config, new Uint8Array(64000));
    expect(result).toMatchObject({ outcome: 'failed', failureCode: 'BENCHMARK_TRANSPORT_MISMATCH' });
    expect(result.transport).toBeUndefined();
    expect(fixture.deleted()).toBe(true);
  } finally { await new Promise<void>(yes => fixture.server.close(() => yes())); }
});
