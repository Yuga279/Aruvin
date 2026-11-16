/**
 * ============================================================================
 * FILE: load-config.spec.ts
 * LOCATION: backend/src/platform/config/load-config.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify validated environment parsing, finite budgets, and readiness status.
 *
 * ROLE IN PROJECT:
 *    Ensures the platform uses server-side identity and safe single-process
 *    defaults while separating configuration parsing from dependency readiness.
 *
 * KEY COMPONENTS:
 *    - Configuration tests: Enforce profile, topology, and budget validation.
 *    - Readiness tests: Report missing external service/provider settings.
 * ============================================================================
 */

import { DEFAULT_BUDGETS } from '../../contracts/budgets.js';
import { loadConfig, readinessIssues } from './load-config.js';

const valid = {
  PORT: '3000',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  AURVIN_USER_ID: 'aurvin-dev-user',
  PERSISTENCE_PROFILE: 'unknown',
  MONGODB_URI: '',
  MONGODB_DB_NAME: 'aurvin',
  OPENROUTER_API_KEY: '',
  OPENROUTER_MODEL: '',
};

describe('loadConfig', () => {
  it('applies finite defaults including conservative document headroom', () => {
    const config = loadConfig(valid);
    expect(config.port).toBe(3000);
    expect(config.identity.userId).toBe('aurvin-dev-user');
    expect(config.persistence.profile).toBe('unknown');
    expect(config.persistence.documentHeadroomBytes).toBe(1_800_000);
    expect(config.budgets).toEqual(DEFAULT_BUDGETS);
    expect(config.topology.executor).toBe('single-process');
    expect(config.openRouter.disableTransforms).toBe(true);
    expect(config.openRouter.dataCollection).toBe('deny');
  });

  it('fails on invalid profile, empty user id, or multi-replica topology', () => {
    expect(() => loadConfig({ ...valid, PERSISTENCE_PROFILE: 'cosmos' })).toThrow();
    expect(() => loadConfig({ ...valid, AURVIN_USER_ID: '' })).toThrow();
    expect(() =>
      loadConfig({ ...valid, AURVIN_EXECUTOR_TOPOLOGY: 'multi-replica' }),
    ).toThrow();
  });

  it('fails on non-finite or history-starving budget overrides', () => {
    expect(() => loadConfig({ ...valid, MAX_OUTPUT_TOKENS: '-1' })).toThrow();
    expect(() =>
      loadConfig({
        ...valid,
        MAX_CONTEXT_TOKENS: '100',
        MAX_OUTPUT_TOKENS: '80',
        MODEL_MARGIN_TOKENS: '40',
      }),
    ).toThrow();
  });

  it('does not allow budget overrides to exceed conservative storage bounds', () => {
    expect(() =>
      loadConfig({ ...valid, MAX_DOCUMENT_BYTES: '1800001' }),
    ).toThrow();
  });

  it('reports readiness issues when provider and persistence settings are missing', () => {
    const config = loadConfig(valid);
    expect(readinessIssues(config)).toEqual([
      'OPENROUTER_API_KEY is missing',
      'OPENROUTER_MODEL is missing',
      'MONGODB_URI is missing',
    ]);
    const ready = loadConfig({
      ...valid,
      OPENROUTER_API_KEY: 'sk-test',
      OPENROUTER_MODEL: 'openrouter/test',
      MONGODB_URI: 'mongodb://localhost:27017',
    });
    expect(readinessIssues(ready)).toEqual([]);
  });
});
