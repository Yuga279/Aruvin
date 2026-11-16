/**
 * ============================================================================
 * FILE: voice-capabilities.ts
 * LOCATION: frontend/src/features/voice/state/voice-capabilities.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Shared safe public-voice-config store with explicit refresh.
 *
 * ROLE IN PROJECT:
 *    Lets P5 refresh browser capabilities after confirmed admin saves without
 *    remounting session controllers or carrying secrets.
 *
 * KEY COMPONENTS:
 *    - createVoiceCapabilitiesStore: Latest-response fenced public snapshot.
 *    - refreshVoiceCapabilities: P5 entry after confirmed nonsecret writes.
 * ============================================================================
 */

import { VoiceHttpClient } from '../../../api/voice-client.ts';
import type { PublicVoiceConfig } from '../../../api/voice-protocol.ts';

export function createVoiceCapabilitiesStore(load: (signal: AbortSignal) => Promise<PublicVoiceConfig>) {
  let value: PublicVoiceConfig | null = null;
  let requested = false;
  let epoch = 0;
  let abort: AbortController | undefined;
  let pending: Promise<boolean> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PublicVoiceConfig | null) => {
    value = next; listeners.forEach(listener => listener());
  };
  const refresh = () => {
    requested = true; abort?.abort(); abort = new AbortController();
    const sequence = ++epoch; const signal = abort.signal;
    pending = (async () => {
      try {
        const next = await load(signal);
        if (sequence !== epoch || signal.aborted) return false;
        const copy = structuredClone(next);
        Object.freeze(copy.enabledModes); Object.freeze(copy.limits);
        Object.freeze(copy.supportedLocales); Object.freeze(copy.inputAudio); Object.freeze(copy.outputAudio);
        publish(Object.freeze(copy)); return true;
      } catch {
        if (sequence === epoch && !signal.aborted) publish(null);
        return false;
      }
    })();
    return pending;
  };
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    ensureLoaded: () => requested ? pending ?? Promise.resolve(value !== null) : refresh(),
  };
}
const http = new VoiceHttpClient();
export const voiceCapabilities = createVoiceCapabilitiesStore(signal => http.config(signal));
export function refreshVoiceCapabilities(): Promise<boolean> { return voiceCapabilities.refresh(); }
