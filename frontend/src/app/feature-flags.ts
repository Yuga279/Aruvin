/**
 * ============================================================================
 * FILE: feature-flags.ts
 * LOCATION: frontend/src/app/feature-flags.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compile-time switches for workspace areas that have no backend yet.
 *
 * ROLE IN PROJECT:
 *    Navigation only renders an area when its flag is on, so unfinished
 *    capabilities never appear as if they work. Turn a flag on in the
 *    release that ships the area's backend. These are not runtime or
 *    per-user settings and must never come from VITE_* variables.
 *
 * KEY COMPONENTS:
 *    - FEATURE_FLAGS: all off in Release 0
 * ============================================================================
 */

export const FEATURE_FLAGS = {
  home: false,
  projects: false, // Release 5
  agents: false, // Release 3
  memory: false, // Release 5
  workspace: false, // Release 2
  automations: false, // Release 8
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
