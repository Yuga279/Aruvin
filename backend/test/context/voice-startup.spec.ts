/**
 * ============================================================================
 * FILE: voice-startup.spec.ts
 * LOCATION: backend/test/context/voice-startup.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Startup integration test for createContextAssembler with voice delivery reader.
 *
 * ROLE IN PROJECT:
 *    Ensures startup wiring forwards the metadata delivery reader dependency and
 *    rebuilds heard context on each assembly without dropping speech updates.
 *
 * KEY COMPONENTS:
 *    - createContextAssembler: Startup factory verification with delivery reader forwarding.
 *    - Dynamic delivery update: Re-assembly reflects updated delivery status.
 * ============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { createContextAssembler } from '../../src/context/create-context-assembler.js';
import { buildReferenceManifest } from '../../src/context/reference-selection.js';
import { ports, record, request } from './fixtures.js';

it('forwards delivery reads through startup and rebuilds heard context on every assembly', async () => {
  const records = [record({ mode: 'live', visibility: 'internal' }), record({ messageId: 'm2', eventId: 'e2',
    sequence: 1, role: 'assistant', attemptId: 'a1', completionStatus: 'completed',
    mode: 'live', visibility: 'internal', content: 'Hello. More.' })];
  const dependencies = ports(records);
  const value = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', textGenerated: 'Hello. More.' });
  const metadata = { getVoiceDelivery: vi.fn(async () => value) };
  const { assembler, assets } = await createContextAssembler({ ...dependencies, metadata,
    paths: { knowledge: new URL('../../../product_knowledge.md', import.meta.url),
      instructions: new URL('../../src/instructions/system.md', import.meta.url) } });
  dependencies.memory.get.mockResolvedValue(buildReferenceManifest('u1', 's1', 1, records, assets, DEFAULT_BUDGETS));
  const unknown = await assembler.assemble(request);
  expect(unknown.ok).toBe(true);
  if (!unknown.ok) throw new Error('expected context');
  expect(unknown.context.messages[5].content).toContain('delivery is unknown');
  metadata.getVoiceDelivery.mockResolvedValue({ ...value, status: 'interrupted', sequence: 2,
    textSpoken: 'Hello.', textRemaining: ' More.' });
  const corrected = await assembler.assemble(request);
  expect(corrected.ok).toBe(true);
  if (!corrected.ok) throw new Error('expected context');
  expect(corrected.context.messages.slice(3)).toEqual([
    { role: 'system', content: 'Response mode: text.' },
    { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello.' },
    { role: 'user', content: request.newUserInput },
  ]);
  expect(metadata.getVoiceDelivery).toHaveBeenCalledTimes(2);
});
