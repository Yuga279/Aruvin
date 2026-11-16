/**
 * ============================================================================
 * FILE: config-docs.spec.ts
 * LOCATION: backend/test/assembly/config-docs.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify operator guidance matches database-backed configuration sources.
 *
 * ROLE IN PROJECT:
 *    Locks infrastructure-only examples, launcher messaging, and runbook
 *    categories without snapshotting prose or running application checks.
 *
 * KEY COMPONENTS:
 *    - Example mapping: backend example stays within bootstrap names.
 *    - Launcher/runbook: no automatic import, key generation, or live claims.
 * ============================================================================
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOOTSTRAP_ENV_NAMES, LEGACY_MANAGEABLE_ENV_NAMES } from '../../src/platform/config/bootstrap-config.js';

const example = readFileSync(resolve('.env.example'), 'utf8');
const readme = readFileSync(resolve('../README.md'), 'utf8');
const setup = readFileSync(resolve('../setup.bat'), 'utf8');
const run = readFileSync(resolve('../run.bat'), 'utf8');
const runbook = readFileSync(resolve('../docs/super-admin-config/operations.md'), 'utf8');

function assignments(text: string): string[] {
  return [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]!);
}

describe('configuration operator docs', () => {
  it('ships only infrastructure settings in the backend example', () => {
    const names = assignments(example);
    expect(names).toContain('AURVIN_CONFIG_ENCRYPTION_KEY');
    expect(names.every(name => (BOOTSTRAP_ENV_NAMES as readonly string[]).includes(name))).toBe(true);
    expect(names.some(name => (LEGACY_MANAGEABLE_ENV_NAMES as readonly string[]).includes(name))).toBe(false);
    expect(example).toContain('AURVIN_CONFIG_ENCRYPTION_KEY=');
    expect(example).toMatch(/does not configure (text|voice)/i);
  });

  it('points operators at Manage Aurvin instead of environment editing', () => {
    expect(readme).toContain('Manage Aurvin');
    expect(readme).toContain('Super admin');
    expect(readme).toContain('config');
    expect(readme).toContain('AURVIN_CONFIG_ENCRYPTION_KEY');
    expect(readme).toContain('docs/super-admin-config/operations.md');
  });

  it('keeps launchers free of automatic import and key generation', () => {
    for (const launcher of [setup, run]) {
      expect(launcher).not.toContain('import-config');
      expect(launcher).not.toContain('randomBytes');
      expect(launcher).not.toContain('openssl');
    }
    expect(setup).toContain('Manage Aurvin');
    expect(run).toContain('Manage Aurvin');
  });

  it('documents runbook procedures without live, paid, or deployment claims', () => {
    expect(runbook).toContain('node --enable-source-maps dist/scripts/import-config.js');
    expect(runbook).toContain('randomBytes');
    expect(runbook).toContain('AURVIN_CONFIG_ENCRYPTION_KEY');
    expect(runbook).toContain('X-Forwarded-Proto');
    expect(runbook).toContain('P7');
    expect(runbook).not.toMatch(/staging validated|production ready|production deployment|certified/i);
    expect(runbook).toMatch(/unrun|not (run|authorized)/i);
  });

  it('links referenced operator files that exist', () => {
    expect(existsSync(resolve('../README.md'))).toBe(true);
    expect(existsSync(resolve('../setup.bat'))).toBe(true);
    expect(existsSync(resolve('../run.bat'))).toBe(true);
    expect(existsSync(resolve('.env.example'))).toBe(true);
    expect(existsSync(resolve('../docs/super-admin-config/goal.md'))).toBe(true);
    expect(runbook).toContain('../README.md');
  });
});
