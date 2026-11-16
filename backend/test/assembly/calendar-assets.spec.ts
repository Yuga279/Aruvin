/**
 * ============================================================================
 * FILE: calendar-assets.spec.ts
 * LOCATION: backend/test/assembly/calendar-assets.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify fixed multi-calendar instructions and unchanged release-asset boundaries.
 *
 * ROLE IN PROJECT:
 *    Loads real bounded Markdown assets without service or database access.
 *    Keeps tool policy separate from voice/Canvas behavior and live certification.
 *
 * KEY COMPONENTS:
 *    - Asset assertions: Stable skill tools, Calendar policy, size, and secrecy.
 *    - Historical runbook assertion: Existing exact scope evidence stays readable.
 * ============================================================================
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadFixedAssets } from '../../src/instructions/fixed-assets.js';
import { CALENDAR_SCOPES } from '../../src/contracts/calendar-policy.js';

it('loads conditional text tools without weakening voice or Canvas instructions', async () => {
  const assets = await loadFixedAssets({
    instructions: 'src/instructions/system.md', knowledge: '../product_knowledge.md',
  });
  expect(assets.instructions).not.toContain('Live voice has no Calendar tools');
  expect(assets.instructions).toContain('Structured Calendar results already supply the Canvas');
  expect(assets.instructions).toContain('calendar_create_event');
  expect(assets.instructions).toContain('activate_skill');
  expect(assets.instructions).toContain('call_tool');
  expect(assets.instructions).toContain('Response mode: voice.');
  expect(assets.instructions).toContain('Canvas');
  expect(assets.knowledge).not.toContain('No live MCP connections, external tool execution, plugins');
  expect(assets.instructions).toContain('calendar_check_availability');
  expect(assets.instructions).not.toContain('Text chat may use only currently advertised Google Calendar tools');
  expect(assets.instructions).toContain('explicit calendar request → saved default override → primary');
  expect(assets.instructions).toContain('incomplete coverage');
  expect(assets.instructions).toContain('not a reservation');
  expect(assets.instructions).toContain('Do not require a JSON echo');
  expect(assets.instructions).toContain('at most one tool call');
  expect(assets.instructions).toContain('one calendar per decision');
  expect(assets.instructions).not.toContain('server-authorized owned target');
  expect(assets.knowledge).toContain('shared writable calendars');
  expect(assets.instructions).toContain('Release: phase1.v2');
  expect(assets.knowledge).toContain('Release: phase1.v1');
  expect(Buffer.byteLength(assets.instructions, 'utf8')).toBeLessThanOrEqual(16384);
  expect(Buffer.byteLength(assets.knowledge, 'utf8')).toBeLessThanOrEqual(16384);
  expect(assets.instructions).not.toMatch(/sk-or-v1-|mongodb(?:\+srv)?:\/\/|-----BEGIN /);
  expect(assets.knowledge).not.toMatch(/sk-or-v1-|mongodb(?:\+srv)?:\/\/|-----BEGIN /);
});

it('keeps the exact Calendar scopes in the operator runbook', () => {
  const text = readFileSync('../docs/google-calendar-plugin/operations.md', 'utf8');
  for (const scope of CALENDAR_SCOPES) expect(text).toContain(scope);
});
