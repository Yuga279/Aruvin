/**
 * ============================================================================
 * FILE: platform.module.spec.ts
 * LOCATION: backend/src/platform/platform.module.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify PlatformModule loads infrastructure-only bootstrap config.
 *
 * ROLE IN PROJECT:
 *    Confirms the Nest composition exposes BootstrapConfig with one
 *    value-free legacy notice and rejects invalid infrastructure statically.
 *
 * KEY COMPONENTS:
 *    - Obsolete-name warning: emitted once, names only, no values.
 *    - Bootstrap token: singleton BootstrapConfig with safety, no openRouter.
 * ============================================================================
 */

import { Test } from '@nestjs/testing';
import { AURVIN_CONFIG } from './tokens.js';
import {
  BOOTSTRAP_ENV_NAMES,
  LEGACY_MANAGEABLE_ENV_NAMES,
  type BootstrapConfig,
} from './config/bootstrap-config.js';
import { ServerIdentityResolver } from './identity/server-identity-resolver.js';
import { PlatformModule } from './platform.module.js';

describe('PlatformModule', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('loads infrastructure only and emits obsolete names once', async () => {
    for (const name of [...BOOTSTRAP_ENV_NAMES, ...LEGACY_MANAGEABLE_ENV_NAMES])
      vi.stubEnv(name, undefined);
    vi.stubEnv('OPENROUTER_API_KEY', 'fixture-obsolete-key');
    vi.stubEnv('MAX_INPUT_CHARS', 'not-a-number');
    vi.stubEnv('MONGODB_URI', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FRONTEND_ORIGIN', 'http://localhost:5173');
    const warning = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const module = await Test.createTestingModule({ imports: [PlatformModule] }).compile();
    try {
      const first = module.get<BootstrapConfig>(AURVIN_CONFIG);
      expect(module.get(AURVIN_CONFIG)).toBe(first);
      expect(first).toHaveProperty('safety');
      expect(first).not.toHaveProperty('openRouter');
      expect(() => module.get(ServerIdentityResolver).resolve()).toThrow('UNAUTHENTICATED');
      expect(warning).toHaveBeenCalledTimes(1);
      const line = String(warning.mock.calls[0]![0]);
      expect(line).toContain('OPENROUTER_API_KEY');
      expect(line).toContain('MAX_INPUT_CHARS');
      expect(line).not.toContain('fixture-obsolete-key');
      expect(line).not.toContain('not-a-number');
    } finally {
      await module.close();
    }
  });

  it('emits no notice without obsolete settings', async () => {
    for (const name of [...BOOTSTRAP_ENV_NAMES, ...LEGACY_MANAGEABLE_ENV_NAMES])
      vi.stubEnv(name, undefined);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FRONTEND_ORIGIN', 'http://localhost:5173');
    const warning = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const module = await Test.createTestingModule({ imports: [PlatformModule] }).compile();
    try {
      const config = module.get<BootstrapConfig>(AURVIN_CONFIG);
      expect(config).toHaveProperty('safety');
      expect(config).not.toHaveProperty('openRouter');
      expect(warning).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('rejects invalid infrastructure with a static configuration error', async () => {
    for (const name of [...BOOTSTRAP_ENV_NAMES, ...LEGACY_MANAGEABLE_ENV_NAMES])
      vi.stubEnv(name, undefined);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FRONTEND_ORIGIN', 'http://localhost:5173');
    vi.stubEnv('PORT', 'not-a-port');
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(
      Test.createTestingModule({ imports: [PlatformModule] }).compile(),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });
});
