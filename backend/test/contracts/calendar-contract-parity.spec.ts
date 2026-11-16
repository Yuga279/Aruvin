/**
 * ============================================================================
 * FILE: calendar-contract-parity.spec.ts
 * LOCATION: backend/test/contracts/calendar-contract-parity.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Check truthful Calendar tool descriptions and runtime/advertised contracts.
 *
 * ROLE IN PROJECT:
 *    Keeps model-visible JSON Schema aligned with the authoritative Zod inputs
 *    without making structural schema projection an authorization boundary.
 *
 * KEY COMPONENTS:
 *    - Description assertions for opaque Aurvin cursors and ownership evidence.
 *    - Structural and semantic parity checks for all five supported tools.
 * ============================================================================
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CALENDAR_TOOLS, calendarInputSchemas } from '../../src/contracts/calendar-tools.js';

it('describes an Aurvin continuation and qualified manager evidence, not a raw Google token', () => {
  const listing = CALENDAR_TOOLS.find(tool => tool.name === 'calendar_list_calendars')!;
  expect(listing.inputSchema.required).toEqual([]);
  expect(calendarInputSchemas.calendar_list_calendars.parse({})).toEqual({});
  expect(listing.description).toContain('Aurvin continuation');
  expect(listing.description).toContain('manager access');
  expect(listing.description).toContain('not proof of data ownership');
});

it('advertises voice Calendar accurately without weakening timed-only create limits', () => {
  const system = readFileSync(new URL('../../src/instructions/system.md', import.meta.url), 'utf8');
  expect(system).not.toContain('Live voice has no Calendar tools');
  expect(system).toContain('All-day reads preserve date-only starts and exclusive end dates');
  expect(system).toContain('Do not enumerate every agenda entry unless asked');
  expect(system).toContain('Structured Calendar results already supply the Canvas');
  expect(system).toContain('Only a durable Calendar receipt confirms creation');
  expect(system).toContain('all-day creation');
});

it('keeps Node engine and Zod and has no retired MCP SDK dependencies', () => {
  const backend = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const frontend = JSON.parse(readFileSync(new URL('../../../frontend/package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  const engine = '^22.22.3 || ^24.15.0 || >=26.0.0';
  expect(backend.engines.node).toBe(engine);
  expect(frontend.engines.node).toBe(engine);
  expect(backend.dependencies.zod).toBe('^3.25.32');
  expect(lock.packages['node_modules/zod'].version).toBe('3.25.76');
  expect(backend.dependencies['@modelcontextprotocol/client']).toBeUndefined();
  expect(backend.dependencies['@modelcontextprotocol/server']).toBeUndefined();
  for (const name of ['@modelcontextprotocol/sdk', '@langchain/mcp-adapters', 'googleapis']) {
    expect(backend.dependencies[name]).toBeUndefined();
    expect(frontend.dependencies[name]).toBeUndefined();
  }
});
