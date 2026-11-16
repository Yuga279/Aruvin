/**
 * ============================================================================
 * FILE: create-context-assembler.ts
 * LOCATION: backend/src/context/create-context-assembler.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Load frozen fixed assets and construct a ready ContextAssembler instance.
 *
 * ROLE IN PROJECT:
 *    Startup factory for P9 wiring. Asset loading happens before any assemble
 *    work is accepted; a failed load does not return a partial assembler.
 *
 * KEY COMPONENTS:
 *    - createContextAssembler: Explicit paths, injected read ports, frozen snapshot.
 * ============================================================================
 */

import { loadFixedAssets, type AssetPaths } from '../instructions/fixed-assets.js';
import { ReferencedContextAssembler, type ContextDependencies } from './referenced-context-assembler.js';

export async function createContextAssembler(options: Omit<ContextDependencies, 'assets'> & { paths: AssetPaths }) {
  const assets = await loadFixedAssets(options.paths);
  const assembler = new ReferencedContextAssembler({
    memory: options.memory,
    messages: options.messages,
    metadata: options.metadata,
    budgets: options.budgets,
    assets,
  });
  return Object.freeze({ assembler, assets });
}
