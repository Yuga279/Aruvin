/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: frontend/src/features/voice/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Public exports for the voice feature subsystem.
 *
 * ROLE IN PROJECT:
 *    Exposes live voice hooks, UI components, and state helpers without
 *    eagerly initializing browser audio or media devices.
 *
 * KEY COMPONENTS:
 *    - useLiveVoice, LiveVoiceSurface
 *    - LiveVoicePanel
 *    - showsLiveVoice, LiveVoiceState
 * ============================================================================
 */

export { useLiveVoice, type LiveVoiceSurface } from './state/useLiveVoice.ts';
export { LiveVoicePanel } from './live/LiveVoicePanel.tsx';
export { showsLiveVoice, type LiveVoiceState } from './state/live-voice-reducer.ts';
export { refreshVoiceCapabilities } from './state/voice-capabilities.ts';
