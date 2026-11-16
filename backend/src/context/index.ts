/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/context/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export P3 context assembly, reference construction, and fixed-asset loading.
 *
 * ROLE IN PROJECT:
 *    Integration barrel for P5/P9 without exposing persistence, graph runtime,
 *    or tool-protocol test fixtures.
 *
 * KEY COMPONENTS:
 *    - createContextAssembler / ReferencedContextAssembler: Runtime handoff.
 *    - buildReferenceManifest / loadFixedAssets: Manifest and version helpers.
 * ============================================================================
 */

export { createContextAssembler } from './create-context-assembler.js';
export { ReferencedContextAssembler, type ContextDependencies } from './referenced-context-assembler.js';
export { buildReferenceManifest } from './reference-selection.js';
export { loadFixedAssets, type AssetPaths, type FixedAssets } from '../instructions/fixed-assets.js';
export { estimatePromptTokens, fixedContextMessages, assertFixedContextFits, defaultEnvironmentContext, environmentContextMessage } from './context-budget.js';
