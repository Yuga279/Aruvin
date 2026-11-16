/**
 * ============================================================================
 * FILE: livekit-pipeline-fixture.ts
 * LOCATION: backend/test/voice/agent/livekit-pipeline-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compose the real LiveFlow, AgentVoiceAdapter and VoiceDelivery against
 *    the fake LiveKit RTC boundary for deterministic acceptance checks.
 *
 * ROLE IN PROJECT:
 *    Supplies one in-memory runtime, fake speech providers and a trusted
 *    SessionContext without P2 admission, MongoDB, network or paid calls.
 *
 * KEY COMPONENTS:
 *    - pipeline(): Connects the media bridge and exposes controls/records.
 * ============================================================================
 */

// Import the RTC fake before any module that binds @livekit/rtc-node.
import { rtcFixture, type RtcFixture } from '../transport/livekit-fixture.js';
import { expect, vi } from 'vitest';
import { LiveKitMediaBridge } from '../../../src/voice/transport/livekit-media.js';
import { AgentVoiceAdapter, type VoiceBridgeRuntime } from '../../../src/voice/agent/agent-voice-adapter.js';
import { LiveFlow } from '../../../src/voice/session/live-flow.js';
import type { ExecuteTurn } from '../../../src/chat-runtime/ports.js';
import type { VoiceDeliveryRecord } from '../../../src/contracts/voice.js';
import type { LiveKitAdmissionTicket } from '../../../src/contracts/voice.js';
import {
  INPUT_AUDIO,
  VoiceControlReassembler,
  livekitAgentIdentity,
  type VoiceClientPayload,
  type VoiceServerEvent,
} from '../../../src/contracts/voice-wire.js';
import {
  createSessionResponseFixture,
  enabledVoiceEnvironment,
} from '../../../src/contracts/testing/voice-fixtures.js';
import { loadVoiceConfig } from '../../../src/platform/config/voice-config.js';
import type { SessionContext, VoiceSink } from '../../../src/voice/session/voice-session.options.js';
import { attempt } from '../../persistence/fixtures.js';
import { fakeStt, fakeTts } from '../session/fixtures.js';
import { settle } from '../transport/fixtures.js';

export const usage = {
  providerRequestId: null,
  model: 'fixture',
  modelVersion: null,
  audioMs: 100,
  billableCharacters: 12,
};

async function until(predicate: () => boolean) {
  for (let i = 0; i < 40 && !predicate(); i++) await settle();
  if (!predicate()) throw new Error('condition not reached');
}

export async function pipeline() {
  const response = createSessionResponseFixture('live');
  const expiresAtMs = Date.now() + response.limits.connectMs;
  response.expiresAt = new Date(expiresAtMs).toISOString();
  const voice = loadVoiceConfig(enabledVoiceEnvironment());
  const context: SessionContext = {
    identity: {
      userId: 'aurvin-dev-user',
      source: 'authenticated-session',
      openRouterUser: 'aurvin-dev-user',
    },
    response,
    reservation: {
      reservationId: 'reservation-1',
      userId: 'aurvin-dev-user',
      conversationId: null,
      owner: { kind: 'live', voiceSessionId: response.sessionId },
    },
    voiceConfig: { ...voice, dictationWarningMs: 270000 },
    configSnapshot: null,
    assertPaidWork: vi.fn(),
  };
  const ticket: LiveKitAdmissionTicket = {
    transport: response.livekit!,
    agentIdentity: livekitAgentIdentity(response.sessionId),
    agentToken: 'offline-server-token',
    expiresAtMs,
    ttlSeconds: Math.ceil(response.limits.connectMs / 1000),
  };
  const rtc: RtcFixture = rtcFixture(response);
  const stt = fakeStt(), tts = fakeTts();
  const usageSpy = vi.fn(async (_context: SessionContext, _usage: typeof usage) => undefined);
  const records = new Map<string, VoiceDeliveryRecord>();
  let status: 'accepted' | 'completed' | 'cancelled' = 'accepted';
  let agent!: AgentVoiceAdapter;
  let bridge!: LiveKitMediaBridge;

  const runtime: VoiceBridgeRuntime = {
    submitLiveTurn: vi.fn(async c => ({
      sessionId: c.sessionId,
      turnId: 't1',
      attemptId: 'a1',
      userMessageId: 'm1',
      streamPath: `/sessions/${c.sessionId}/turns/t1/stream`,
    })),
    findLiveSubmission: vi.fn(async () => null),
    getLiveTurnStatus: vi.fn(async (_u, sessionId, turnId) => ({
      sessionId,
      turnId,
      attemptId: 'a1',
      status,
      truncated: false,
      error: null,
    })),
    getLiveDelivery: vi.fn(async () => records.get('a1') ?? null),
    cancelLiveTurn: vi.fn(async () => { status = 'cancelled'; }),
    reconcileSession: vi.fn(async () => {
      expect([...records.values()].some(record => record.status === 'pending')).toBe(false);
    }),
    executeTurn: vi.fn(async (command: ExecuteTurn) => {
      const live = command.live!;
      await live.start(
        {
          ...attempt(),
          userId: command.userId,
          sessionId: command.sessionId,
          turnId: command.turnId,
          attemptId: command.attemptId,
        },
        async (record, expected) => {
          if (expected !== undefined) expect(records.get('a1')?.sequence).toBe(expected);
          records.set('a1', structuredClone(record));
        },
      );
      try {
        await live.delta('Hello world.');
        await live.finish();
        await live.settle('Hello world.', command.signal);
        if (!command.signal.aborted) status = 'completed';
      } finally {
        if (command.signal.aborted) status = 'cancelled';
      }
    }),
  };

  const open = vi.fn(async (
    c: SessionContext,
    sink: VoiceSink,
    signal: AbortSignal,
  ): Promise<LiveFlow> => {
    agent = new AgentVoiceAdapter(runtime, async (_voiceSessionId, conversationId) => {
      c.response.conversationId = conversationId;
      c.reservation = c.reservation ? { ...c.reservation, conversationId } : null;
    });
    const flow = await LiveFlow.open(c, sink, signal, {
      stt: stt.port,
      tts: tts.port,
      hooks: agent.hooks,
      usage: usageSpy,
    });
    agent.attach(c, flow, sink);
    return flow;
  });
  const ended = vi.fn(async (_reason: 'completed' | 'cancelled' | 'error') => {
    await bridge.dispose();
  });
  const disconnected = vi.fn(async (_recoverable: boolean) => {
    await bridge.dispose();
  });
  bridge = await LiveKitMediaBridge.connect({ context, ticket, open, ended, disconnected });

  const events = (): VoiceServerEvent[] => {
    const reassembler = new VoiceControlReassembler('server', 'live', {
      sessionId: response.sessionId,
      connectionEpoch: response.connectionEpoch,
    });
    const out: VoiceServerEvent[] = [];
    for (const packet of rtc.controlPackets) {
      try {
        const result = reassembler.push(packet.bytes);
        if (result.status === 'complete') out.push(result.event);
      } catch {
        // Ignore partial or malformed fixture traffic.
      }
    }
    return out;
  };

  let sequence = 0;
  const control = async (payload: VoiceClientPayload) => {
    rtc.emitControl(payload, sequence++);
    await settle();
  };
  await control({ type: 'session.start', mode: 'live', audioSettings: INPUT_AUDIO });
  await until(() => events().some(event => event.type === 'session.ready'));

  const begin = async () => {
    stt.events.push({ type: 'end-of-turn', providerTurnId: 'input-1', text: 'Question 1' });
    stt.events.push({ type: 'end-of-turn', providerTurnId: 'input-1', text: 'Question 1' });
    await until(() => agent.currentResponse() !== null && records.has('a1'));
    return agent.currentResponse()!;
  };

  return {
    response,
    context,
    ticket,
    rtc,
    stt,
    tts,
    runtime,
    records,
    events,
    control,
    begin,
    ref: () => agent.currentResponse()!,
    agent: () => agent,
    bridge: () => bridge,
    source: rtc.sources[0],
    usage: usageSpy,
    ended,
    disconnected,
    until,
    close: () => bridge.dispose(),
  };
}
