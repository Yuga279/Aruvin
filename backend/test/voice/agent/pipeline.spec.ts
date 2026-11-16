/**
 * ============================================================================
 * FILE: pipeline.spec.ts
 * LOCATION: backend/test/voice/agent/pipeline.spec.ts
 * ============================================================================
 * PURPOSE:
 *    Exercise the agent bridge, delivery tracker, flow and wire transport offline.
 * ROLE IN PROJECT:
 *    Uses an in-memory runtime port, not a database or paid model, to verify
 *    multi-turn speech lifetimes, exact cursors, cancellation and durable drain.
 * KEY COMPONENTS:
 *    - pipeline: Real voice composition with deterministic runtime/provider ports.
 * ============================================================================
 */
import { afterEach, expect, it, vi } from 'vitest';
import { AgentVoiceAdapter, type VoiceBridgeRuntime } from '../../../src/voice/agent/agent-voice-adapter.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import { VoiceConnection } from '../../../src/voice/transport/voice-connection.js';
import type { ExecuteTurn } from '../../../src/chat-runtime/ports.js';
import type { VoiceBinding } from '../../../src/voice/session/voice-session.service.js';
import type { VoiceDeliveryRecord } from '../../../src/contracts/voice.js';
import type { VoiceClientPayload } from '../../../src/contracts/voice-wire.js';
import { INPUT_AUDIO } from '../../../src/contracts/voice-wire.js';
import { decodeVoiceAudio, encodeVoiceAudio } from '../../../src/contracts/voice-audio.js';
import { attempt } from '../../persistence/fixtures.js';
import { key } from '../../../src/persistence/records.js';
import { parseVoiceControl, type CanvasArtifactProjection } from '../../../src/contracts/voice-wire.js';
import { options, origin, request, fakeStt, fakeTts, owner } from '../session/fixtures.js';
import { FakeSocket, settle } from '../transport/fixtures.js';

afterEach(() => vi.useRealTimers());
const usage = { providerRequestId: null, model: 'fixture', modelVersion: null, audioMs: 100, billableCharacters: 12 };
async function until(predicate: () => boolean) {
  for (let i = 0; i < 40 && !predicate(); i++) await settle();
  expect(predicate()).toBe(true);
}

async function pipeline(thinking = false, artifactScript?: (live: NonNullable<ExecuteTurn['live']>, attemptId: string, responseId: string) => Promise<void>) {
  const o = options(), stt = fakeStt(), tts = fakeTts(), socket = new FakeSocket();
  const records = new Map<string, VoiceDeliveryRecord>();
  const submitted = new Map<string, { sessionId: string; turnId: string; attemptId: string; userMessageId: string; streamPath: string }>();
  let binding!: VoiceBinding, bridge!: AgentVoiceAdapter, flow!: LiveFlow, serial = 0, sequence = 0;
  let status: 'accepted' | 'completed' | 'cancelled' = 'accepted';
  let blockWrite: ((record: VoiceDeliveryRecord) => Promise<void> | void) | undefined;
  const runtime: VoiceBridgeRuntime = {
    submitLiveTurn: vi.fn(async c => {
      const n = ++serial; status = 'accepted';
      const result = { sessionId: c.sessionId, turnId: `t${n}`, attemptId: `a${n}`, userMessageId: `m${n}`,
        streamPath: `/sessions/${c.sessionId}/turns/t${n}/stream` };
      submitted.set(c.idempotencyKey, result); return result;
    }),
    findLiveSubmission: vi.fn(async c => submitted.get(c.idempotencyKey) ?? null),
    getLiveTurnStatus: vi.fn(async (_u, s, t) => ({ sessionId: s, turnId: t, attemptId: `a${serial}`,
      status, truncated: false, error: null })),
    getLiveDelivery: vi.fn(async (_u, _s, a) => records.get(a) ?? null),
    cancelLiveTurn: vi.fn(async () => { status = 'cancelled'; }),
    reconcileSession: vi.fn(async () => { expect([...records.values()].some(r => r.status === 'pending')).toBe(false); }),
    executeTurn: vi.fn(async (c: ExecuteTurn) => {
      const live = c.live!;
      await live.start({ ...attempt(), userId: c.userId, sessionId: c.sessionId, turnId: c.turnId, attemptId: c.attemptId },
        async (record, expected) => {
          if (expected !== undefined) expect(records.get(c.attemptId)?.sequence).toBe(expected);
          if (blockWrite) {
            if (blockWrite.length > 0) {
              await blockWrite(record);
            } else if (record.playedSamples !== null) {
              await blockWrite(record);
            }
          }
          records.set(c.attemptId, structuredClone(record));
        });
      live.modelStarted?.();
      let text = '';
      try {
        if (thinking) {
          await new Promise<void>(resolve => {
            if (c.signal.aborted) resolve(); else c.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          status = 'cancelled';
        } else {
          live.modelOutput?.();
          if (artifactScript) {
            const responseId = key('voice-response', c.userId, c.sessionId, c.attemptId);
            await artifactScript(live, c.attemptId, responseId);
            text = records.get(c.attemptId)?.textGenerated ?? '';
          } else {
            text = 'Hello world.';
            await live.delta(text);
          }
          await live.finish(); status = 'completed';
        }
      } finally { await live.settle(text, c.signal); }
    }),
  };
  const sessions = new VoiceSessionService(o);
  o.reservations.bindConversation = vi.fn(async c => ({ ...binding.reservation!, conversationId: c.conversationId }));
  o.open = async (c, sink, signal) => {
    bridge = new AgentVoiceAdapter(runtime, (id, s) => sessions.bindConversation(id, s));
    flow = await LiveFlow.open(c, sink, signal, { stt: stt.port, tts: tts.port, hooks: bridge.hooks, usage: o.usage });
    bridge.attach(c, flow, sink); return flow;
  };
  const created = await sessions.create({ ...request, mode: 'live' }, origin, owner);
  binding = sessions.claim(created.cookie.split(';')[0], origin, owner);
  const connection = new VoiceConnection(sessions, binding, socket);
  const control = async (payload: VoiceClientPayload) => {
    connection.receive(Buffer.from(JSON.stringify({ protocolVersion: 1, sessionId: binding.response.sessionId,
      connectionEpoch: binding.response.connectionEpoch, eventId: `e${sequence}`, sequence: sequence++, ...payload })), false);
    await settle();
  };
  await control({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
  await until(() => socket.events().some(e => e.type === 'session.ready'));
  const begin = async (n: number) => {
    stt.events.push({ type: 'end-of-turn', providerTurnId: `input-${n}`, text: `Question ${n}` });
    await until(() => bridge.currentResponse()?.turnId === `t${n}` && records.has(`a${n}`));
    if (!thinking) await until(() => vi.mocked(tts.connection.flush).mock.calls.length >= n);
    return bridge.currentResponse()!;
  };
  const audioSamples = () => socket.send.mock.calls.reduce((n, [data]) => typeof data === 'string'
    ? n : n + decodeVoiceAudio(data).pcm.byteLength / 2, 0);
  return { stt, tts, runtime, socket, connection, sessions, records, control, begin, audioSamples,
    input: () => connection.receive(encodeVoiceAudio({ kind: 1, flags: 0, sequence: 0, offsetMs: 0, pcm: new Uint8Array(2560) }), true),
    bridge: () => bridge, flow: () => flow, block: (write?: (record: VoiceDeliveryRecord) => Promise<void> | void) => { blockWrite = write; },
    close: async () => { await connection.dispose(); await sessions.drain(); } };
}

it('completes three long bursty irregular replies with per-response origins and no inference replay', async () => {
  vi.useFakeTimers(); const f = await pipeline(); let wire = 0;
  try {
    for (let n = 1; n <= 3; n++) {
      const ref = await f.begin(n);
      f.stt.events.push({ type: 'end-of-turn', providerTurnId: `input-${n}`, text: `Question ${n}` });
      f.tts.events.push({ type: 'speech-started', ...ref, speechId: `s${n}` });
      f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(50) });
      for (let i = 0; i < 11; i++) f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(9600) });
      f.tts.events.push({ type: 'speech-completed', ...ref, speechId: `s${n}`, audioDurationMs: 2201, usage });
      await settle(); await vi.advanceTimersByTimeAsync(3000);
      expect(f.records.get(`a${n}`)?.status).toBe('pending');
      expect(f.socket.events().some(e => e.type === 'session.error')).toBe(false);
      // First acknowledgment frees a playback window. Wire gaps round only response origins.
      await f.control({ type: 'playback.progress', ...ref, playedSamples: wire + 9600, playedMs: Math.floor((wire + 9600) / 24) });
      await until(() => f.audioSamples() === n * 52825);
      wire += 52825;
      await f.control({ type: 'playback.progress', ...ref, playedSamples: wire, playedMs: Math.floor(wire / 24) });
      await until(() => f.bridge().currentResponse() === null);
      expect(f.records.get(`a${n}`)).toMatchObject({ status: 'completed', playedSamples: 52825, audioSamples: 52825 });
      wire = Math.ceil(wire / 24) * 24;
    }
    expect(f.runtime.executeTurn).toHaveBeenCalledTimes(3);
  } finally { await f.close(); }
});

it('cancels before the first token without issuing provider Interrupt or fabricating heard text', async () => {
  const f = await pipeline(true);
  try {
    await f.begin(1);
    f.stt.events.push({ type: 'start-of-turn', providerTurnId: 'new-speech' });
    await until(() => f.bridge().currentResponse() === null);
    expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
    expect(f.records.get('a1')).toMatchObject({ status: 'cancelled', playedSamples: 0, textSpoken: '' });
    expect(f.socket.events().some(e => e.type === 'session.error')).toBe(false);
  } finally { await f.close(); }
});

it('keeps microphone input off a slow progress write and waits for evidence on cancellation/drain', async () => {
  vi.useFakeTimers(); const f = await pipeline(); let release!: () => void;
  try {
    const ref = await f.begin(1);
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 's1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
    const gate = new Promise<void>(resolve => { release = resolve; }); f.block(() => gate);
    await f.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50 });
    f.input(); await until(() => vi.mocked(f.stt.connection.writeAudio).mock.calls.length === 1);
    let drained = false; const close = f.connection.dispose().then(() => { drained = true; });
    await vi.advanceTimersByTimeAsync(2000); expect(drained).toBe(false);
    f.block(); release(); await vi.advanceTimersByTimeAsync(2000); await close;
    expect(f.records.get('a1')?.status).not.toBe('pending');
  } finally { release?.(); await f.close(); }
});

it('does not hold microphone frames behind a slow durable interrupt', async () => {
  vi.useFakeTimers(); const f = await pipeline(); let release!: () => void;
  try {
    const ref = await f.begin(1);
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 's1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(f.runtime.cancelLiveTurn!).mockImplementationOnce(async () => { await gate; });
    const interrupt = f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 });
    f.input();
    try { await until(() => vi.mocked(f.stt.connection.writeAudio).mock.calls.length === 1); }
    finally { release(); await interrupt; }
    await vi.advanceTimersByTimeAsync(2000);
  } finally { release?.(); await f.close(); }
});

it('interrupts synthesized but undrained output, then completes two more replies without inventing heard text', async () => {
  vi.useFakeTimers(); const f = await pipeline();
  try {
    for (let n = 1; n <= 3; n++) {
      const ref = await f.begin(n);
      f.tts.events.push({ type: 'speech-started', ...ref, speechId: `s${n}` });
      f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
      f.tts.events.push({ type: 'speech-completed', ...ref, speechId: `s${n}`, audioDurationMs: 100, usage }); await settle();
      if (n === 1) {
        await f.control({ type: 'response.interrupt', ...ref, playedSamples: 1200, playbackPositionMs: 50 });
        await vi.advanceTimersByTimeAsync(2000);
        expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
      } else await f.control({ type: 'playback.progress', ...ref, playedSamples: n * 2400, playedMs: n * 100 });
      await until(() => f.bridge().currentResponse() === null);
      expect(f.records.get(`a${n}`)).toMatchObject(n === 1 ? { status: 'unknown', textSpoken: null, playedSamples: 1200 }
        : { status: 'completed', textSpoken: 'Hello world.', playedSamples: 2400 });
    }
    expect(f.socket.events().some(e => e.type === 'session.error')).toBe(false);
  } finally { await f.close(); }
});

it('acknowledges initial listening without reopening providers or creating a turn', async () => {
  const f = await pipeline();
  try {
    await f.control({ type: 'input.unmute' });
    expect(f.socket.events()).toContainEqual(expect.objectContaining({
      type: 'voice.state', input: 'listening', agent: 'idle', connection: 'connected',
    }));
    expect(f.stt.port.connect).toHaveBeenCalledOnce();
    expect(f.tts.port.connect).toHaveBeenCalledOnce();
    expect(f.runtime.submitLiveTurn).not.toHaveBeenCalled();
    expect(f.runtime.executeTurn).not.toHaveBeenCalled();
    expect(f.records.size).toBe(0);
  } finally { await f.close(); }
});

it('suspends input without cancelling output and keeps drain behind durable heard evidence', async () => {
  vi.useFakeTimers(); const f = await pipeline(); let release!: () => void;
  try {
    const ref = await f.begin(1);
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 'quiet-output' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) }); await settle();
    await f.control({ type: 'input.suspend' });
    f.input(); await settle();
    expect(f.stt.connection.writeAudio).not.toHaveBeenCalled();
    expect(f.runtime.cancelLiveTurn).not.toHaveBeenCalled();
    expect(f.tts.connection.interrupt).not.toHaveBeenCalled();
    expect(f.audioSamples()).toBe(2400);
    const pending = new Promise<void>(resolve => { release = resolve; }); f.block(() => pending);
    await f.control({ type: 'playback.progress', ...ref, playedSamples: 1200, playedMs: 50 });
    let closed = false;
    const drain = f.connection.dispose().then(() => { closed = true; });
    await vi.advanceTimersByTimeAsync(2000); expect(closed).toBe(false);
    f.block(); release(); await vi.advanceTimersByTimeAsync(2000); await drain;
    expect(f.records.get('a1')?.status).not.toBe('pending');
    expect(f.tts.connection.flush).toHaveBeenCalledOnce();
    expect(f.runtime.executeTurn).toHaveBeenCalledOnce();
  } finally { release?.(); await f.close(); }
});

it('journals and emits artifacts before audio start, dedups identical replays, and isolates speech synthesis', async () => {
  vi.useFakeTimers();
  const f = await pipeline(false, async (live, _attemptId, responseId) => {
    await live.delta('Hello world.');
    const artifact: CanvasArtifactProjection = {
      responseId,
      ordinal: 0,
      kind: 'mermaid',
      subType: 'Flowchart',
      title: 'Approval path',
      rawSource: 'flowchart TD\nA --> B',
    };
    expect(await live.artifact?.(artifact)).toBe(true);
    // Identical replay deduplication:
    expect(await live.artifact?.(artifact)).toBe(true);
  });
  try {
    const ref = await f.begin(1);
    // Before speech-started, verify wire artifact receipt before audio.start
    const events = f.socket.events();
    expect(events.some(e => e.type === 'audio.start')).toBe(false);
    const artifactEvents = events.filter(e => e.type === 'canvas.artifact');
    expect(artifactEvents).toHaveLength(1);
    const emitted = artifactEvents[0];
    expect(parseVoiceControl(JSON.stringify(emitted), 'server', 'live')).toEqual(emitted);
    expect(emitted).toMatchObject({
      type: 'canvas.artifact',
      turnId: ref.turnId,
      responseId: ref.responseId,
      ordinal: 0,
      kind: 'mermaid',
      subType: 'Flowchart',
      title: 'Approval path',
      rawSource: 'flowchart TD\nA --> B',
    });
    // Journal snapshot already contains the projection
    expect(f.records.get('a1')?.canvasArtifacts).toEqual([
      {
        responseId: ref.responseId,
        ordinal: 0,
        kind: 'mermaid',
        subType: 'Flowchart',
        title: 'Approval path',
        rawSource: 'flowchart TD\nA --> B',
      },
    ]);
    // TTS speak calls do not contain artifact source
    expect(f.tts.connection.speak).toHaveBeenCalled();
    for (const [call] of vi.mocked(f.tts.connection.speak).mock.calls) {
      expect(call.text).not.toContain('flowchart');
    }
    // Complete the turn cleanly so delivery settles
    f.tts.events.push({ type: 'speech-started', ...ref, speechId: 's1' });
    f.tts.events.push({ type: 'audio', ...ref, pcm: new Uint8Array(4800) });
    f.tts.events.push({ type: 'speech-completed', ...ref, speechId: 's1', audioDurationMs: 100, usage });
    await settle();
    await f.control({ type: 'playback.progress', ...ref, playedSamples: 2400, playedMs: 100 });
    await until(() => f.bridge().currentResponse() === null);
  } finally {
    await f.close();
  }
});

it('handles barge-in during blocked artifact journal write without emitting late event or dropping mic input', async () => {
  vi.useFakeTimers();
  let releaseWrite!: () => void;
  const writeBlocked = new Promise<void>(resolve => { releaseWrite = resolve; });
  let writeEntered = false;
  const f = await pipeline(false, async (live, _attemptId, responseId) => {
    const artifact: CanvasArtifactProjection = {
      responseId,
      ordinal: 0,
      kind: 'mermaid',
      subType: 'Flowchart',
      title: 'Approval path',
      rawSource: 'flowchart TD\nA --> B',
    };
    await live.artifact?.(artifact);
  });
  f.block(async record => {
    if (record.canvasArtifacts?.length && !writeEntered) {
      writeEntered = true;
      await writeBlocked;
    }
  });
  try {
    f.stt.events.push({ type: 'end-of-turn', providerTurnId: 'input-1', text: 'Question 1' });
    await until(() => writeEntered);
    const currentResp = f.bridge().currentResponse()!;
    await f.control({ type: 'response.interrupt', ...currentResp, playedSamples: 0, playbackPositionMs: 0 });
    f.input();
    await until(() => vi.mocked(f.stt.connection.writeAudio).mock.calls.length === 1);
    releaseWrite();
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    await until(() => f.bridge().currentResponse() === null);
    expect(f.socket.events().some(e => e.type === 'canvas.artifact')).toBe(false);
    expect(f.records.get('a1')?.canvasArtifacts).toHaveLength(1);
    expect(f.stt.port.connect).toHaveBeenCalledOnce();
    expect(f.tts.port.connect).toHaveBeenCalledOnce();
  } finally {
    releaseWrite?.();
    await f.close();
  }
});
