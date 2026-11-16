/**
 * ============================================================================
 * FILE: dependency-pins.spec.ts
 * LOCATION: backend/src/platform/dependency-pins.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the runtime and dependency compatibility pins required by P1.
 *
 * ROLE IN PROJECT:
 *    Guards shared backend/frontend package boundaries and the supported
 *    Node.js engine floor before downstream plans build on these dependencies.
 *
 * KEY COMPONENTS:
 *    - Dependency assertions: Pin backend LangChain, MongoDB, and Zod ranges.
 *    - Engine assertions: Keep both applications on the Nest 12 Node floor.
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = join(backendDir, '..');

const backendPkg = JSON.parse(
  readFileSync(join(backendDir, 'package.json'), 'utf8'),
) as {
  dependencies: Record<string, string>;
  engines?: { node?: string };
  scripts: Record<string, string>;
};

const frontendPkg = JSON.parse(
  readFileSync(join(repoRoot, 'frontend/package.json'), 'utf8'),
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines?: { node?: string };
};

const backendLock = JSON.parse(
  readFileSync(join(backendDir, 'package-lock.json'), 'utf8'),
) as {
  packages: Record<string, { version?: string }>;
};

describe('P1 dependency pins', () => {
  it('pins LangGraph, OpenRouter, MongoDB 6.x, and zod on the backend', () => {
    expect(backendPkg.dependencies['@langchain/langgraph']).toBe('^1.4.19');
    expect(
      backendPkg.dependencies['@langchain/langgraph-checkpoint-mongodb'],
    ).toBe('^1.4.1');
    expect(backendPkg.dependencies['@langchain/core']).toBe('^1.2.16');
    expect(backendPkg.dependencies['@langchain/openrouter']).toBe('^0.4.17');
    expect(backendPkg.dependencies['mongodb']).toBe('^6.21.0');
    expect(backendPkg.dependencies['zod']).toBe('^3.25.32');
  });

  it('does not use mongodb 7.x', () => {
    expect(backendPkg.dependencies['mongodb']).toMatch(/^\^6\./);
    expect(backendPkg.dependencies['mongodb']).not.toMatch(/^\^7/);
  });

  it('locks undici beyond the patched 6.28.0 vulnerability range', () => {
    const version = backendLock.packages['node_modules/undici']?.version;
    expect(version).toBeDefined();
    const [major, minor, patch] = version!.split('.').map(Number);
    expect(
      major > 6 || (major === 6 && (minor > 28 || (minor === 28 && patch >= 1))),
    ).toBe(true);
  });

  it('declares the Nest 12 Node engine floor on both apps', () => {
    expect(backendPkg.engines?.node).toBe(
      '^22.22.3 || ^24.15.0 || >=26.0.0',
    );
    expect(frontendPkg.engines?.node).toBe(
      '^22.22.3 || ^24.15.0 || >=26.0.0',
    );
  });

  it('does not add LangGraph or MongoDB to the frontend', () => {
    const frontendAll = {
      ...frontendPkg.dependencies,
      ...frontendPkg.devDependencies,
    };
    expect(frontendAll['@langchain/langgraph']).toBeUndefined();
    expect(frontendAll['@langchain/openrouter']).toBeUndefined();
    expect(frontendAll['mongodb']).toBeUndefined();
  });
});
