/**
 * ============================================================================
 * FILE: embedded-vad.d.ts
 * LOCATION: frontend/src/features/voice/audio/embedded-vad.d.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Missing TypeScript declarations for the pinned embedded VAD subpath.
 *
 * ROLE IN PROJECT:
 *    The published package types cover the fetching root entry, not
 *    `@ozymandiasthegreat/vad/lib/embedded.js`. This ambient module must not
 *    share a basename with audio-capture-vad.ts or tsc treats it as that
 *    file's output types and ignores the wrapper.
 *
 * KEY COMPONENTS:
 *    - VADMode.AGGRESSIVE: Live capture aggressiveness constant.
 *    - EmbeddedVad: processFrame/destroy surface used by the wrapper.
 * ============================================================================
 */

declare module '@ozymandiasthegreat/vad/lib/embedded.js' {
  export const VADMode: { readonly AGGRESSIVE: 2 }
  export type EmbeddedVad = { processFrame(frame: Int16Array): number; destroy(): void }
  export default function createVad(): Promise<new (mode: number, rate: number) => EmbeddedVad>
}
