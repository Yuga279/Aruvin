/**
 * ============================================================================
 * FILE: node-fs.d.ts
 * LOCATION: frontend/src/styles/node-fs.d.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Minimal node:fs typing so stylesheet tests compile under vite/client.
 *
 * ROLE IN PROJECT:
 *    tsconfig.app.json only includes Vite client types. This shim lets P7
 *    style contract tests import readFileSync without changing P1 tsconfig.
 *
 * KEY COMPONENTS:
 *    - node:fs readFileSync declaration
 * ============================================================================
 */

declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: string): string;
}
