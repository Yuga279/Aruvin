/**
 * ============================================================================
 * FILE: vitest.config.azure.ts
 * LOCATION: backend/vitest.config.azure.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Configure the future selected-service compatibility test command.
 *
 * ROLE IN PROJECT:
 *    Provides an honest empty placeholder until P2 adds compatibility tests;
 *    an empty run is not Azure certification or service evidence.
 *
 * KEY COMPONENTS:
 *    - Test selection: Includes only future Azure compatibility specs.
 * ============================================================================
 */

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/compatibility/**/*.azure.spec.ts'],
    passWithNoTests: true,
  },
});
