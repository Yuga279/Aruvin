/**
 * ============================================================================
 * FILE: canvas-multimodal-fixture.ts
 * LOCATION: backend/test/voice/integration/canvas-multimodal-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Offline integration relay across the assembled LiveKit bridge and real UI client.
 *
 * ROLE IN PROJECT:
 *    Connects the real backend runtime/LiveFlow and the real frontend controller/client
 *    through deterministic LiveKit Room doubles, preserving Canvas and delivery evidence.
 *
 * KEY COMPONENTS:
 *    - canvasPipeline: In-memory runtime, P2 session owner, P3 bridge, and UI relay.
 *    - tick/until: Virtual-clock progress and bounded condition synchronization.
 *    - audio/control: Synthetic TTS media and explicit fixture playback proof.
 * ============================================================================
 */

// Load the P5 SDK mock before importing any module that binds @livekit/rtc-node.
import { offlineLiveKit } from '../../assembly/voice-livekit-fixture.js';
import { DataPacketKind } from '@livekit/rtc-node';
import { expect, vi } from 'vitest';
import { textConfigFixture } from '../../runtime/text-config-fixture.js';
import { liveConfigSnapshot } from './integrated-fixture.js';
import { options, origin, request, fakeStt, fakeTts } from '../session/fixtures.js';
import { principal } from '../../assembly/auth-principal-fixture.js';
import { VoiceSessionService } from '../../../src/voice/session/voice-session.service.js';
import type { VoiceBinding } from '../../../src/voice/session/voice-session.options.js';
import { AgentVoiceAdapter } from '../../../src/voice/agent/agent-voice-adapter.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';

import { chunk, usage, done } from '../../fixtures/openrouter/frames.js';
import { attemptsFor, archiveRecords } from '../../../src/chat-runtime/history.js';
import { LIVEKIT_CONTROL_TOPIC, VoiceControlReassembler, livekitAgentIdentity,
  type VoiceClientPayload, type VoiceServerEvent } from '../../../src/contracts/voice-wire.js';
import { matrixFixture } from '../../../../frontend/src/features/voice/integration-tests/matrix-fixture.ts';
import { settle } from '../../../../frontend/src/features/voice/state/testing/live-voice-fixture.ts';

export async function canvasPipeline() {
  const h = textConfigFixture(liveConfigSnapshot());
  const stt = fakeStt(), tts = fakeTts();
  const media = offlineLiveKit();
  const trace: string[] = [], events: VoiceServerEvent[] = [];
  const opened = vi.fn();
  let stream!: ReadableStreamDefaultController<Uint8Array>, modelClosed = false;
  let fetched = false, started = false, samples = 0;
  const body = new ReadableStream<Uint8Array>({ start(c) { stream = c; } });
  h.fetcher.mockImplementationOnce(async () => { fetched = true; return new Response(body,
    { headers: { 'content-type': 'text/event-stream' } }); });
  const compare = h.p.metadata.compareVoiceDelivery.bind(h.p.metadata);
  h.p.metadata.compareVoiceDelivery = async (r, n) => {
    const ok = await compare(r, n);
    if (ok && r.canvasArtifacts?.length) trace.push('artifact-committed');
    return ok;
  };
  const o = options();
  o.currentConfig = h.currentConfig; o.sessions = h.p.sessions; o.reservations = h.runtime.reservations;
  o.livekit = media.admission;
  let adapter!: AgentVoiceAdapter, flow!: LiveFlow, binding!: VoiceBinding;
  const sessions = new VoiceSessionService(o);
  o.open = async (context, sink, signal) => {
    adapter = new AgentVoiceAdapter(h.runtime, (v, s) => sessions.bindConversation(v, s));
    flow = await LiveFlow.open(context, sink, signal, { stt: stt.port, tts: tts.port,
      hooks: adapter.hooks, usage: o.usage });
    adapter.attach(context, flow, sink);
    return flow;
  };
  o.openLiveBridge = async (context, ticket) => {
    const epochNumber = context.response.connectionEpoch;
    const owner = context as VoiceBinding;
    binding = owner;
    let claimed = false;
    const current = () => owner.response.connectionEpoch === epochNumber && owner.state !== 'ended';
    const bridge = await media.connect({ context, ticket,
      open: async (c, sink, signal) => {
        if (!current()) throw new Error('STALE_CONNECTION_EPOCH');
        if (!claimed) {
          expect(sessions.claimLive(c.response.sessionId,
            ticket.transport.participantIdentity, ticket.transport.roomName)).toBe(c);
          claimed = true;
        }
        return o.open(c, sink, signal) as Promise<LiveFlow>;
      },
      ended: async () => { if (current()) await sessions.end(context.response.sessionId); },
      disconnected: async recoverable => {
        if (current()) await sessions.disconnected(owner, recoverable);
      },
    });
    return { close: () => bridge.dispose() };
  };

  let created!: Awaited<ReturnType<typeof sessions.create>>;
  let ui!: ReturnType<typeof matrixFixture>;
  let sendControl!: ReturnType<typeof vi.fn>;
  try {
    created = await sessions.create({ ...request, mode: 'live' }, origin, principal(h.identity.userId));
    const epoch = media.last();
    const serverRoom = epoch.rtc.rooms[0]!;
    const rx = new VoiceControlReassembler('server', 'live', {
      sessionId: created.response.sessionId, connectionEpoch: created.response.connectionEpoch });
    sendControl = vi.fn((event: VoiceServerEvent) => {
      events.push(event);
      if (event.type === 'canvas.artifact') trace.push('artifact-sent');
    });
    const bindings = {
      claimVoiceInput: vi.fn((_mode: 'live', _close: () => void) => 'canvas-lease'),
      writeVoiceDraft: vi.fn(() => true), releaseVoiceInput: vi.fn(),
      bindVoiceConversation: vi.fn(() => true), refreshSessions: vi.fn(),
      openCanvasArtifact: opened,
    };
    ui = matrixFixture('granted', {
      http: { create: async () => structuredClone(created.response), end: id => sessions.end(id) },
      bindings,
    }, created.response);
    serverRoom.localParticipant.publishData.mockImplementation(async (bytes: Uint8Array) => {
      const result = rx.push(bytes);
      if (result.status === 'complete') sendControl(result.event);
      ui.rtc.emit('dataReceived', bytes,
        { identity: livekitAgentIdentity(created.response.sessionId) }, 0, LIVEKIT_CONTROL_TOPIC);
    });
    ui.rtc.participant.publishData.mockImplementation(async (bytes: Uint8Array) => {
      serverRoom.emit('dataReceived', bytes,
        { identity: created.response.livekit!.participantIdentity },
        DataPacketKind.KIND_RELIABLE, LIVEKIT_CONTROL_TOPIC);
    });
  } catch (error) {
    try { await sessions.drain(); } finally { await h.dispose(); }
    throw error;
  }

  const epoch = media.last();
  const source = epoch.rtc.sources[0]!;
  const tick = async (ms = 0) => {
    let remaining = ms;
    do {
      const step = Math.min(10, remaining);
      ui.rtc.clock.value += step;
      await vi.advanceTimersByTimeAsync(step); await settle();
      remaining -= step;
    } while (remaining > 0);
  };
  const until = async (predicate: () => boolean) => {
    for (let n = 0; n < 100 && !predicate(); n++) await tick();
    expect(predicate()).toBe(true);
  };
  const ref = () => {
    const value = adapter.currentResponse();
    if (!value) throw new Error('Expected active fixture response');
    return value;
  };
  const delivery = async () => {
    const sessionId = binding.response.conversationId;
    if (!sessionId) return null;
    const attempt = (await attemptsFor(h.p, h.identity.userId, sessionId)).at(-1);
    return attempt ? h.p.metadata.getVoiceDelivery(h.identity.userId, sessionId, attempt.attemptId) : null;
  };
  const audio = async (count = 2400) => {
    const response = ref();
    if (!started) {
      tts.events.push({ type: 'speech-started', ...response, speechId: 'canvas-speech' });
      started = true;
    }
    const pcm = new Uint8Array(count * 2), view = new DataView(pcm.buffer);
    for (let n = 0; n < count; n++) view.setInt16(n * 2, n % 24 < 12 ? 4000 : -4000, true);
    samples += count; tts.events.push({ type: 'audio', ...response, pcm }); await tick();
  };
  const push = async (text: string) => {
    if (!modelClosed) {
      try { stream.enqueue(new TextEncoder().encode(chunk(text))); }
      catch { modelClosed = true; }
    }
    await tick();
  };
  const endModel = async () => {
    if (!modelClosed) {
      try {
        stream.enqueue(new TextEncoder().encode(chunk('', 'stop') + usage + done));
        stream.close();
      } catch { /* The consumer may already have closed the stream. */ }
      modelClosed = true;
    }
    await tick();
  };
  const control = (payload: Exclude<VoiceClientPayload, { type: 'session.start' }>) =>
    ui.client().control(payload);
  return { h, ui, sessions, binding, media, epoch, source, stt, tts, events, trace, opened, sendControl,
    tick, until, ref, delivery, audio, push, endModel, control,
    bridge: () => adapter, flow: () => flow,
     microphone: (frame = new Int16Array(1280).fill(1000)) => epoch.rtc.pushFrame(frame),
    begin: async (withTurn = true) => {
      await ui.start();
      vi.spyOn(ui.client(), 'progress').mockReturnValue({ playedSamples: 0, playedMs: 0, proof: 'unproven' });
      await until(() => events.some(event => event.type === 'session.ready'));
      epoch.microphone(); ui.attach();
      await until(() => ui.controller.getSnapshot().input === 'listening');
      if (withTurn) {
        stt.events.push({ type: 'end-of-turn', providerTurnId: 'canvas-input-1', text: 'Explain the path.' });
        await until(() => fetched);
      }
    },
    messages: () => archiveRecords(h.p, h.identity.userId, binding.response.conversationId!),
    finishAudio: async () => {
      if (!samples) await audio();
      const response = ref();
      tts.events.push({ type: 'speech-completed', ...response, speechId: 'canvas-speech',
        audioDurationMs: samples / 24, usage: { providerRequestId: null, model: 'fixture',
          modelVersion: null, audioMs: samples / 24,
          billableCharacters: vi.mocked(tts.connection.speak).mock.calls.reduce((n, [c]) => n + c.text.length, 0) } });
      await until(() => events.some(event => event.type === 'audio.watermark' && event.final));
      const final = events.findLast(event => event.type === 'audio.watermark' && event.final);
      if (!final || final.type !== 'audio.watermark') throw new Error('Missing final watermark');
      control({ type: 'playback.progress', turnId: final.turnId, responseId: final.responseId,
        playedSamples: final.lastAudioSample, playedMs: Math.floor(final.lastAudioSample / 24), proof: 'proven' });
      await tick(samples / 24 + 2500);
      await until(() => adapter.currentResponse() === null);
    },
    crashStream: async () => {
      if (!modelClosed) { stream.error(new Error('fixture provider disconnected')); modelClosed = true; }
      await tick();
    },
    close: async () => {
      ui.controller.exit(); await tick(2500);
      try {
        await sessions.end(created.response.sessionId);
        await sessions.drain();
        await epoch.bridge.dispose();
      } finally { await h.dispose(); }
    },
  };
}
