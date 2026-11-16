/**
 * ============================================================================
 * FILE: skill-scale.spec.ts
 * LOCATION: backend/test/performance/skill-scale.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Measure compact catalog and one-schema selection bytes at synthetic scale.
 *
 * ROLE IN PROJECT:
 *    Exercises the real catalog/selection contract over synthetic metadata only;
 *    it registers no plugin, adds no integration, and does not claim admitted
 *    execution or context capacity at those counts.
 *
 * KEY COMPONENTS:
 *    - Synthetic tool metadata generator.
 *    - Catalog shape/size projection and stable single-tool selection.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { compactSkillCatalog, SKILL_NATIVE_TOOLS, selectSkillTools }
  from '../../src/contracts/calendar-tools.js';

it.each([5, 50, 250])('measures %s synthetic tool schemas without registering a plugin', count => {
  const tools = Array.from({ length: count }, (_, index) => ({
    name: `synthetic_${String(index).padStart(3, '0')}`, description: `Read synthetic item ${index}.`,
    revision: 'synthetic.v1', inputSchema: { type: 'object', additionalProperties: false,
      required: ['itemId'], properties: { itemId: { type: 'string', description: 'x'.repeat(512) } } },
  }));
  const catalog = compactSkillCatalog(tools);
  const selected = selectSkillTools({ plugin: 'google-calendar', tools: [tools[0]!.name] }, tools);
  expect(selected).toEqual({ ok: true, tools: [tools[0]] });
  if (!selected.ok) throw new Error(`Unexpected synthetic selection: ${selected.code}`);
  expect(compactSkillCatalog([...tools].reverse())).toEqual(catalog);
  expect(JSON.stringify(catalog)).not.toContain('inputSchema');
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
  const record = { count, catalogBytes: bytes(catalog), allSchemaBytes: bytes(tools),
    selectedSchemaBytes: bytes(selected.tools), nativeBytes: bytes(SKILL_NATIVE_TOOLS),
    integrationsAdded: 0, providerUsage: null, providerLatencyMs: null };
  expect(record.catalogBytes).toBeLessThan(record.allSchemaBytes);
  expect(SKILL_NATIVE_TOOLS.map(t => t.name)).toEqual(['activate_skill', 'call_tool']);
  console.log('SKILL_SCALE', JSON.stringify(record));
});
