/**
 * ============================================================================
 * FILE: useVoiceCapabilities.ts
 * LOCATION: frontend/src/features/voice/state/useVoiceCapabilities.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Subscribe React views to the shared public voice capabilities store.
 *
 * ROLE IN PROJECT:
 *    Loads safe capabilities once on mount without aborting a shared fetch
 *    when one consumer unmounts.
 *
 * KEY COMPONENTS:
 *    - useVoiceCapabilities: External-store subscription plus initial fetch.
 * ============================================================================
 */

import { useEffect, useSyncExternalStore } from 'react';
import { voiceCapabilities } from './voice-capabilities.ts';
const serverSnapshot = () => null;
export function useVoiceCapabilities() {
  const config = useSyncExternalStore(voiceCapabilities.subscribe, voiceCapabilities.getSnapshot, serverSnapshot);
  useEffect(() => { void voiceCapabilities.ensureLoaded(); }, []);
  return config;
}
