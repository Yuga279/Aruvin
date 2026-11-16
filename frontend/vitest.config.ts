/**
 * ============================================================================
 * FILE: vitest.config.ts
 * LOCATION: frontend/vitest.config.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Configure deterministic Vitest discovery for frontend unit tests.
 *
 * ROLE IN PROJECT:
 *    Adds a lightweight Node test environment for client-safe protocol helpers
 *    without changing frontend runtime entry points.
 *
 * KEY COMPONENTS:
 *    - test config: Runs TypeScript unit tests under frontend/src.
 * ============================================================================
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
