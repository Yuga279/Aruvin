/**
 * ============================================================================
 * FILE: skill-evidence.spec.ts
 * LOCATION: backend/test/performance/skill-evidence.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify request evidence stays honest and compare cold probes with the baseline.
 *
 * ROLE IN PROJECT:
 *    Separates conservative byte reservations from unavailable provider usage and
 *    measured wall time, and records whether current serialized cold requests are
 *    like-for-like with the immutable research baseline.
 *
 * KEY COMPONENTS:
 *    - Byte/reservation-unit projection assertions.
 *    - Equivalent cold serializer probe versus recorded baseline.
 * ============================================================================
 */

import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SKILL_NATIVE_TOOLS, compactSkillCatalog } from '../../src/contracts/calendar-tools.js';
import { loadConfig } from '../../src/platform/config/load-config.js';
import { providerParameters } from '../../src/model/policy.js';
import { loadFixedAssets } from '../../src/instructions/fixed-assets.js';
import { fixedContextMessages, environmentContextMessage, responseModeMessage }
  from '../../src/context/context-budget.js';
import { requestEvidence, taskEvidence, BASELINE } from '../assembly/skill-evidence.js';
import type { CapturedBody } from '../assembly/skill-fixture.js';

it('keeps byte reservations and missing live usage separate from measured fixture time', () => {
  const body: CapturedBody = { user: 'u', messages: [{ role: 'user', content: 'é' }], tools: [] };
  const record = requestEvidence(body);
  expect(record.bodyBytes).toBe(Buffer.byteLength(JSON.stringify(body), 'utf8'));
  expect(record.reservationUnits).toBe(64 + Buffer.byteLength(JSON.stringify({
    messages: body.messages, tools: body.tools }), 'utf8') + 32);
  const task = taskEvidence('ordinary', [body, body], 12.5);
  expect(task).toMatchObject({ scenario: 'ordinary', modelRequests: 2, fixtureTaskMs: 12.5,
    providerUsage: { inputTokens: null, outputTokens: null, cachedInputTokens: null,
      uncachedInputTokens: null }, providerLatencyMs: null });
  expect(task.reservationUnits).toBe(record.reservationUnits * 2);
  expect(task.bodyBytes).toBe(record.bodyBytes * 2);
  expect(BASELINE.sourceCommit).toBe('86dd3974d5e000ab05f4d2285879a723fcd3f69f');
  expect(BASELINE.nativeToolsBytes).toBe(2774);
  expect(BASELINE.matchedTaskLatencyMs).toBeNull();
});

it('compares equivalent cold probes with the recorded five-schema baseline', async () => {
  const config = loadConfig({ OPENROUTER_API_KEY: 'fixture-key', OPENROUTER_MODEL: 'fixture/model' });
  const assets = await loadFixedAssets({ instructions: 'src/instructions/system.md', knowledge: '../product_knowledge.md' });
  const prefix = [...fixedContextMessages(assets), environmentContextMessage({ timeZone: 'Etc/UTC',
    currentDate: '2026-11-04', dayOfWeek: 'Wednesday' }), responseModeMessage('text')];
  const tools = SKILL_NATIVE_TOOLS.map(t => ({ type: 'function', function: {
    name: t.name, description: t.description, parameters: t.inputSchema } }));
  const hash = createHash('sha256').update(JSON.stringify(prefix)).digest('hex');
  const comparablePrefix = hash === BASELINE.fixedPrefixSha256;
  const rows = ['What is 2 + 2?', 'Read event abcde',
    'List my calendars and check availability tomorrow', 'Read event abcde again', 'Now find events tomorrow']
    .map((content, index) => {
      const body = { ...providerParameters(config, { user: 'aurvin-dev-user', maxOutputTokens: 256 }),
        messages: [...prefix, { role: 'user', content }], tools, stream: true,
        stream_options: { include_usage: true } };
      return { input: content, comparablePrefix, baselineBodyBytes: BASELINE.coldBodies[index],
        current: requestEvidence(body as CapturedBody) };
    });
  expect(rows).toHaveLength(5);
  expect(tools.map(t => t.function.name)).toEqual(['activate_skill', 'call_tool']);
  expect(JSON.stringify(compactSkillCatalog())).not.toMatch(/inputSchema|additionalProperties/);
  console.log('SKILL_COLD_PROBES', JSON.stringify({ hash, comparablePrefix,
    note: 'Serializer probes exclude runtime catalog insertion; not matched multi-turn tasks.', rows }));
});
