/**
 * ============================================================================
 * FILE: startup.spec.ts
 * LOCATION: backend/test/context/startup.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify explicit-path startup loading and fail-closed fixed-budget checks.
 *
 * ROLE IN PROJECT:
 *    Ensures P9 can await a frozen assembler/asset snapshot before readiness
 *    and never receive a partially initialized assembler after asset failure.
 *
 * KEY COMPONENTS:
 *    - Factory tests: Real file hashes match assembled context versions.
 *    - Configuration tests: Undersized context/message budgets fail before work.
 * ============================================================================
 */

import { createContextAssembler } from '../../src/context/index.js';
import { buildReferenceManifest } from '../../src/context/reference-selection.js';
import { loadFixedAssets } from '../../src/instructions/fixed-assets.js';
import { ports, request } from './fixtures.js';

const paths = { knowledge: new URL('../../../product_knowledge.md', import.meta.url),
  instructions: new URL('../../src/instructions/system.md', import.meta.url) };

describe('context startup', () => {
  it('loads explicit deployment paths before returning an assembler and version snapshot', async () => {
    const dependencies = ports([]);
    const startup = await createContextAssembler({ ...dependencies, paths });
    const empty = buildReferenceManifest('u1', 's1', 0, [], startup.assets, dependencies.budgets);
    dependencies.memory.get.mockResolvedValue(empty);
    const result = await startup.assembler.assemble(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected_context');
    expect(result.context.instructionVersion).toBe(startup.assets.instructionVersion);
    expect(result.context.knowledgeContentHash).toBe(startup.assets.knowledgeContentHash);
    expect(startup.assets).toEqual(await loadFixedAssets(paths));
  });
  it('does not accept work when fixed content cannot fit after reserving output', async () => {
    const dependencies = ports([]);
    await expect(createContextAssembler({ ...dependencies, paths,
      budgets: { ...dependencies.budgets, maxContextTokens: 3200 } }))
      .rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(dependencies.memory.get).not.toHaveBeenCalled();
  });
  it('does not expose a partially initialized assembler after an asset failure', async () => {
    await expect(createContextAssembler({ ...ports(), paths: { ...paths,
      instructions: new URL('./missing-instructions.md', import.meta.url) } }))
      .rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
  it('checks fixed-message bytes even when the total context budget would fit', async () => {
    const dependencies = ports([]);
    await expect(createContextAssembler({ ...dependencies, paths,
      budgets: { ...dependencies.budgets, maxMessageBytes: 1 } }))
      .rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});
