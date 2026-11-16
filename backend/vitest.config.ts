/**
 * ============================================================================
 * FILE: vitest.config.ts
 * LOCATION: backend/vitest.config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Configure backend unit test discovery and exclude deferred test suites.
 *
 * ROLE IN PROJECT:
 *    Keeps routine tests focused on deterministic backend specs while Azure,
 *    behavior, and end-to-end verification use separate explicit commands.
 *
 * KEY COMPONENTS:
 *    - Vitest config: Resolves TypeScript paths and selects unit specs.
 * ============================================================================
 */

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      '**/*.azure.spec.ts',
      '**/*.behavior.spec.ts',
      '**/*.e2e-spec.ts',
    ],
  },
});
