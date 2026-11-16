/**
 * ============================================================================
 * FILE: fixtures.ts
 * LOCATION: backend/test/voice/session/fixtures.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Test fixtures and mock factories for voice session testing.
 *
 * ROLE IN PROJECT:
 *    Provides deterministic mock options, identity resolvers, and dummy ports
 *    for unit and integration tests of voice session management.
 *
 * KEY COMPONENTS:
 *    - origin / request: Common test constants.
 *    - options(): Factory generating default VoiceSessionOptions fixture.
 *    - fakeRoomService(): Deterministic LiveKit admission and room-service fake.
 * ============================================================================
 */

import { vi } from 'vitest';
import type { ManageableSettings } from '../../../src/contracts/admin-config-wire.js';
import type { CurrentConfigPort, RuntimeConfigSnapshot } from '../../../src/contracts/config-runtime.js';
import { livekitConfigFixture } from '../../../src/contracts/testing/voice-fixtures.js';
import { loadBootstrapConfig } from '../../../src/platform/config/bootstrap-config.js';
import { buildRuntimeSnapshot, defaultManageableSettings } from '../../../src/platform/config/manageable-config.js';
import { loadVoiceConfig } from '../../../src/platform/config/voice-config.js';
import { principal } from '../../assembly/auth-principal-fixture.js';
import { LiveKitAdmission, type RoomServiceClientLike } from '../../../src/voice/session/livekit-admission.js';
import type { VoiceSessionOptions } from '../../../src/voice/session/voice-session.options.js';

export const origin = 'http://127.0.0.1:5173';
export const owner = principal('server-user');
export const request = { protocolVersion: 1 as const, mode: 'dictation' as const,
  conversationId: null, locale: 'en-US' as const, idempotencyKey: 'request-0001' };

export function fakeRoomService(): {
  client: RoomServiceClientLike;
  admission: LiveKitAdmission;
} {
  const client: RoomServiceClientLike = {
    deleteRoom: vi.fn(async () => undefined),
    removeParticipant: vi.fn(async () => undefined),
  };
  return {
    client,
    admission: new LiveKitAdmission(() => client),
  };
}

export function options(): VoiceSessionOptions & { roomClient: RoomServiceClientLike } {
  const livekit = livekitConfigFixture();
  const room = fakeRoomService();
  return {
    config: loadVoiceConfig({
      ENABLE_DICTATION_MODE: 'true',
      ENABLE_LIVE_VOICE_MODE: 'true',
      DEEPGRAM_API_KEY: 'fixture-secret',
      LIVEKIT_URL: livekit.url,
      LIVEKIT_API_KEY: livekit.apiKey,
      LIVEKIT_API_SECRET: livekit.apiSecret,
    }),
    frontendOrigin: origin, secureCookie: false,
    assertAccountCurrent: vi.fn(async () => undefined),
    sessions: { get: vi.fn(async () => null) },
    reservations: {
      acquire: vi.fn(async c => ({ reservationId: 'reservation-1', userId: c.identity.userId,
        conversationId: c.conversationId, owner: c.owner })),
      bindConversation: vi.fn(async c => ({ reservationId: c.reservationId,
        userId: c.identity.userId, conversationId: c.conversationId,
        owner: { kind: 'live' as const, voiceSessionId: 'voice-1' } })),
      release: vi.fn(async () => undefined),
    },
    livekit: room.admission,
    roomClient: room.client,
    admission: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    usage: vi.fn(async () => undefined), disconnected: vi.fn(async () => undefined),
    open: vi.fn(async () => ({ start: vi.fn(), input: vi.fn(async () => undefined),
      control: vi.fn(async () => undefined), close: vi.fn(async () => undefined) })),
  };
}

export function revisionFixture() {
  const livekit = livekitConfigFixture();
  function make(revision: number, edit: (s: ManageableSettings) => void = () => {}) {
    const settings = defaultManageableSettings();
    settings.voice.enabledModes = { dictation: true, live: true };
    edit(settings);
    return buildRuntimeSnapshot(loadBootstrapConfig({
      LIVEKIT_URL: livekit.url,
      LIVEKIT_API_KEY: livekit.apiKey,
      LIVEKIT_API_SECRET: livekit.apiSecret,
    }), {
      revision, settings, credentials: { openrouter: null, deepgram: `fixture-speech-${revision}` },
    }, null);
  }
  let value: RuntimeConfigSnapshot | null = make(1);
  const port: CurrentConfigPort = { current: () => value };
  return { port, make, publish: (next: RuntimeConfigSnapshot | null) => { value = next; } };
}

import type { SpeechInputConnection, SpeechOutputConnection, SttEvent, TtsEvent } from '../../../src/contracts/voice.js';

export class EventQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private done = false;
  private waiter?: (value: IteratorResult<T>) => void;

  push(value: T) {
    if (this.done) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  end() {
    this.done = true;
    this.waiter?.({ value: undefined, done: true });
    this.waiter = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise(resolve => { this.waiter = resolve; });
      }
    };
  }
}

export function fakeStt() {
  const events = new EventQueue<SttEvent>();
  const connection: SpeechInputConnection = {
    events,
    writeAudio: vi.fn(async () => undefined),
    finalize: vi.fn(async () => undefined),
    close: vi.fn(async () => { events.end(); })
  };
  return { events, connection, port: { connect: vi.fn(async () => connection) } };
}

export function fakeTts() {
  const events = new EventQueue<TtsEvent>();
  const connection: SpeechOutputConnection = {
    events,
    providerSocketId: 'provider-socket-1',
    speak: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    close: vi.fn(async () => { events.end(); })
  };
  return { events, connection, port: { connect: vi.fn(async () => connection) } };
}

