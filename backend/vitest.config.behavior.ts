/**
 * ============================================================================
 * FILE: vitest.config.behavior.ts
 * LOCATION: backend/vitest.config.behavior.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Configure the future model/application behavior verification command.
 *
 * ROLE IN PROJECT:
 *    Provides an honest empty placeholder until P10 adds behavior evaluations;
 *    an empty run is not evidence of model or application behavior.
 *
 * KEY COMPONENTS:
 *    - Test selection: Includes only future behavior evaluation specs.
 * ============================================================================
 */

import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/evaluations/**/*.behavior.spec.ts'],
    passWithNoTests: true,
  },
});
