/**
 * ============================================================================
 * FILE: dictation-fixture.ts
 * LOCATION: frontend/src/features/voice/dictation/testing/dictation-fixture.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Deterministic test fixture for DictationController and P4 ports.
 *
 * ROLE IN PROJECT:
 *    Provides mock capture, socket client, and HTTP session implementations
 *    for unit and integration tests without physical microphone/network hardware.
 *
 * KEY COMPONENTS:
 *    - dictationFixture: Factory for controller test harness with spies
 *    - settle: Microtask settling helper
 * ============================================================================
 */

import { vi } from 'vitest';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO,
  type PublicVoiceConfig, type VoiceServerPayload } from '../../../../api/voice-protocol.ts';
import { session } from '../../transport/testing/voice-fakes.ts';
import { DictationController, type DictationPorts } from '../dictation-controller.ts';
import { snapshotDraft } from '../dictation-draft.ts';

export async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
export function dictationFixture(original = 'Before OLD after', start = 7, end = 10) {
  const response = session(1, 'dictation');
  const config: PublicVoiceConfig = { protocolVersion: 1,
    enabledModes: { dictation: true, live: true }, supportedLocales: ['en-US'],
    limits: { ...DEFAULT_VOICE_LIMITS }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
  let text = original, token = 0, sequence = 0;
  let captureCallbacks!: Parameters<DictationPorts['capture']>[0];
  let clientCallbacks!: Parameters<DictationPorts['client']>[0];
  const capture = { start: vi.fn(async () => {}), setMuted: vi.fn(async (_muted: boolean, _maxPendingMs?: number) => {}),
    stop: vi.fn(async (_drain = false) => {}) };
  const client = { connect: vi.fn(), sendInput: vi.fn((_pcm: Uint8Array, _flags?: 0 | 1) => true),
    control: vi.fn((_payload: Parameters<ReturnType<DictationPorts['client']>['control']>[0]) => true),
    dispose: vi.fn() };
  const http = { create: vi.fn(async (_request: Parameters<DictationPorts['http']['create']>[0],
    _signal?: AbortSignal) => response), end: vi.fn(async (_id: string) => {}) };
  const bindings = {
    claimVoiceInput: vi.fn((): string | null => `lease-${++token}`),
    writeVoiceDraft: vi.fn((_token: string, value: string) => { text = value; return true; }),
    releaseVoiceInput: vi.fn(), isVoiceInputLocked: vi.fn(() => false),
  };
  const controller = new DictationController({ http, bindings,
    capture: callbacks => { captureCallbacks = callbacks; return capture; },
    client: callbacks => { clientCallbacks = callbacks; return client; } });
  const event = (payload: VoiceServerPayload) => clientCallbacks.event?.({ protocolVersion: 1,
    sessionId: response.sessionId, connectionEpoch: response.connectionEpoch,
    eventId: `event-${sequence}`, sequence: sequence++, ...payload });
  const begin = async () => {
    await controller.start(snapshotDraft(original, start, end, 'backward'), null, config);
    event({ type: 'session.ready', limits: response.limits,
      effectiveAudioSettings: response.effectiveAudioSettings });
    await settle();
  };
  return { controller, response, config, capture, client, http, bindings, begin, event,
    text: () => text, callbacks: () => clientCallbacks,
    frame: (pcm: Uint8Array, flags: 0 | 1 = 0) => captureCallbacks.frame(pcm, flags) };
}
