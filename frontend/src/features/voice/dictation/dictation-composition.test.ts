/**
 * ============================================================================
 * FILE: dictation-composition.test.ts
 * LOCATION: frontend/src/features/voice/dictation/dictation-composition.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration test for VoiceClient transport, DictationController, and chat state.
 *
 * ROLE IN PROJECT:
 *    Verifies full stack composition from WebSocket audio frame delivery and
 *    server transcription events to draft updates, draft-only fencing, and explicit Send.
 *
 * KEY COMPONENTS:
 *    - Dictation composition integration test suite
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { VoiceClient, type VoiceClientOptions } from '../../../api/voice-client.ts';
import { decodeVoiceAudio } from '../../../api/voice-audio.ts';
import { DEFAULT_VOICE_LIMITS, INPUT_AUDIO, OUTPUT_AUDIO, type PublicVoiceConfig } from '../../../api/voice-protocol.ts';
import { chatReducer, initialChatState } from '../../chat/state/chat-reducer.ts';
import type { ChatState } from '../../chat/state/chat-types.ts';
import { FakeSocket, session, ready, control } from '../transport/testing/voice-fakes.ts';
import { DictationController, type DictationPorts } from './dictation-controller.ts';
import { snapshotDraft } from './dictation-draft.ts';
import { settle } from './testing/dictation-fixture.ts';

it('never submits during pauses and sends exactly the finalized selected-span draft after explicit review', async () => {
  let state: ChatState = { ...initialChatState, draftInput: 'Before OLD after' };
  const socket = new FakeSocket();
  let captureCallbacks!: Parameters<DictationPorts['capture']>[0];
  let cleanup: (() => void) | undefined;
  let owner: string | null = null;
  const config: PublicVoiceConfig = { protocolVersion: 1,
    enabledModes: { dictation: true, live: false }, supportedLocales: ['en-US'],
    limits: { ...DEFAULT_VOICE_LIMITS }, inputAudio: INPUT_AUDIO, outputAudio: OUTPUT_AUDIO };
  const submitTurn = vi.fn();
  const dispatch: (action: import('../../chat/state/chat-types.ts').ChatAction) => void =
    action => { state = chatReducer(state, action); };
  const controller = new DictationController({
    http: { create: async () => session(1, 'dictation'), end: vi.fn(async () => {}) },
    client: (callbacks: VoiceClientOptions) => new VoiceClient({ ...callbacks,
      pageUrl: 'https://aurvin.example/chat', socket: () => socket.asSocket() }),
    capture: callbacks => {
      captureCallbacks = callbacks;
      return { start: async () => {}, setMuted: async () => {}, stop: async drain => {
        if (drain) captureCallbacks.frame(new Uint8Array(640), 1);
      } };
    },
    bindings: {
      claimVoiceInput: (mode, onClose) => {
        if (owner) return null;
        owner = 'lease-1'; cleanup = onClose;
        dispatch({ type: 'CLAIM_VOICE_INPUT', payload: { token: owner, mode } });
        return owner;
      },
      writeVoiceDraft: (token, text) => {
        if (owner !== token) return false;
        dispatch({ type: 'VOICE_DRAFT', payload: { token, text } }); return true;
      },
      releaseVoiceInput: token => {
        if (owner !== token) return;
        owner = null; dispatch({ type: 'RELEASE_VOICE_INPUT', payload: token });
      },
      isVoiceInputLocked: () => owner !== null,
    },
  });
  await controller.start(snapshotDraft(state.draftInput, 7, 10), null, config);
  socket.open(); socket.receive(ready(0, 1, 'dictation')); await settle();
  socket.receive(control({ type: 'dictation.partial', segmentId: '0:0', text: 'not' }, 1));
  expect(state.draftInput).toBe('Before not after');
  socket.receive(control({ type: 'dictation.partial', segmentId: '0:0', text: 'not Friday' }, 2));
  expect(state.draftInput).toBe('Before not Friday after');
  socket.receive(control({ type: 'dictation.final', segmentId: '0:0', text: 'Not Friday.' }, 3));
  expect(state.draftInput).toBe('Before Not Friday. after');
  expect(state.activeSessionId).toBeNull();
  expect(state.messages).toEqual([]);
  expect(controller.getSnapshot().phase).toBe('recording');
  expect(submitTurn).not.toHaveBeenCalled();
  await controller.stop();
  const binary = socket.sent.filter((value): value is Uint8Array => value instanceof Uint8Array);
  expect(decodeVoiceAudio(binary.at(-1)!)).toMatchObject({ kind: 1, flags: 1, sequence: 0 });
  const last = JSON.parse(socket.sent.at(-1) as string);
  expect(last.type).toBe('dictation.stop');
  expect(state.voiceInput).not.toBeNull();
  socket.receive(control({ type: 'dictation.partial', segmentId: '0:1.8', text: 'ID A' }, 4));
  expect(state.draftInput).toBe('Before Not Friday. ID A after');
  socket.receive(control({ type: 'dictation.final', segmentId: '0:1.8', text: 'ID A-7.' }, 5));
  expect(state.draftInput).toBe('Before Not Friday. ID A-7. after');
  socket.receive(control({ type: 'dictation.complete', finalization: 'complete', unfinalizedTail: false }, 6));
  expect(state.voiceInput).toBeNull();
  expect(state.draftInput).toBe('Before Not Friday. ID A-7. after');
  expect(socket.close).toHaveBeenCalledTimes(1);
  expect(submitTurn).not.toHaveBeenCalled();
  // Explicit review/Send is the only point at which a text submission is permitted.
  submitTurn(state.draftInput);
  expect(submitTurn).toHaveBeenCalledExactlyOnceWith('Before Not Friday. ID A-7. after');
  cleanup?.(); // Idempotent after normal completion; no duplicate teardown.
  expect(socket.close).toHaveBeenCalledTimes(1);
});
