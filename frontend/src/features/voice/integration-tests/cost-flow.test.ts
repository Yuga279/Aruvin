/**
 * ============================================================================
 * FILE: cost-flow.test.ts
 * LOCATION: frontend/src/features/voice/integration-tests/cost-flow.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the live UI follows backend quieting without adding a client VAD gate.
 *
 * ROLE IN PROJECT:
 *    Integrates the real LiveKit client/controller with deterministic Room doubles
 *    to protect one-microphone ownership and backend-controlled input state.
 *
 * KEY COMPONENTS:
 *    - matrixFixture: LiveKit Room and microphone test harness.
 * ============================================================================
 */

import { afterEach, expect, it, vi } from 'vitest';
import { matrixFixture } from './matrix-fixture.ts';
import { settle } from '../state/testing/live-voice-fixture.ts';

afterEach(() => vi.useRealTimers());

it('reflects backend quieting without a second capture or client VAD upload gate', async () => {
  const f = matrixFixture('granted');
  try {
    await f.begin();
    const requests = f.rtc.microphone.mock.calls.length;
    f.event({ type: 'voice.state', input: 'suspended', agent: 'idle', connection: 'connected' });
    await settle();
    expect(f.controller.getSnapshot().input).toBe('suspended');
    expect(f.rtc.mediaTrack.enabled).toBe(true);
    expect(f.rtc.packets().some(packet => packet.type === 'input.suspend')).toBe(false);
    f.listening(); await settle();
    expect(f.controller.getSnapshot().input).toBe('listening');
    expect(f.rtc.microphone).toHaveBeenCalledTimes(requests);
    await f.controller.toggleMute();
    expect(f.rtc.mediaTrack.enabled).toBe(false);
  } finally { f.controller.exit(); await settle(); }
});
