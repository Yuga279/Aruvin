/**
 * ============================================================================
 * FILE: voice-context.spec.ts
 * LOCATION: backend/test/assembly/voice-context.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Regress next-turn voice context through the real application assembly.
 *
 * ROLE IN PROJECT:
 *    Captures AppService's runtime dependencies with offline persistence ports,
 *    retaining its real assembler and observed voice-delivery reader wiring.
 *
 * KEY COMPONENTS:
 *    - Initial context: Empty history needs no delivery evidence.
 *    - Subsequent context: Settled live speech and current input appear once.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { AppService, type AssemblyPorts } from '../../src/app.service.js';
import type { RuntimeDependencies } from '../../src/chat-runtime/index.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { manifest, ports, record, request } from '../context/fixtures.js';
import { assemblyFixture } from './admin-config-fixture.js';

it.each([
  { status: 'completed', textSpoken: 'HEARD. More.', textRemaining: '' },
  { status: 'interrupted', textSpoken: 'HEARD.', textRemaining: ' More.' },
] as const)('assembles the next live turn from $status delivery through AppService', async delivery => {
  const f = assemblyFixture();
  const records: ReturnType<typeof record>[] = [];
  const context = ports(records);
  const getVoiceDelivery = vi.fn(async () => voiceDeliveryRecordSchema.parse({
    ...deliveryFixture(), userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
    textGenerated: 'HEARD. More.', ...delivery,
  }));
  let captured: RuntimeDependencies | undefined;
  const service = await AppService.create(f.bootstrap, {
    ...f.ports,
    open: (async () => ({
      ...f.bundle, memory: context.memory, messages: context.messages,
      metadata: { ...f.bundle.metadata, getVoiceDelivery },
    })) as AssemblyPorts['open'],
    runtime: dependencies => {
      captured = dependencies;
      return f.raw as never;
    },
  });
  try {
    if (!captured) throw new Error('AppService did not create its runtime');
    // Match the runtime's attempt-budget projection without replacing its assembler.
    const assembler = captured.assembler.forBudgets!(service.config.budgets);
    const initial = await assembler.assemble({ ...request, turnId: 't1', newUserInput: 'Hello', responseMode: 'voice' });
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error('Expected initial context');
    expect(initial.context.messages.slice(3)).toEqual([
      { role: 'system', content: 'Response mode: voice.' }, { role: 'user', content: 'Hello' },
    ]);
    expect(getVoiceDelivery).not.toHaveBeenCalled();

    records.push(
      record({ visibility: 'internal', mode: 'live', completionStatus: 'completed' }),
      record({ messageId: 'm2', eventId: 'e2', sequence: 1, role: 'assistant',
        content: 'HEARD. More.', completionStatus: 'completed', attemptId: 'a1',
        visibility: 'internal', mode: 'live' }),
      record({ messageId: 'm3', eventId: 'e3', sequence: 2, turnId: request.turnId,
        content: request.newUserInput, visibility: 'internal', mode: 'live' }),
    );
    context.memory.get.mockResolvedValue(manifest(records));
    const subsequent = await assembler.assemble({ ...request, responseMode: 'voice' });
    expect(subsequent.ok).toBe(true);
    if (!subsequent.ok) throw new Error('Expected subsequent context');
    expect(subsequent.context.messages.slice(3)).toEqual([
      { role: 'system', content: 'Response mode: voice.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: delivery.textSpoken },
      { role: 'user', content: request.newUserInput },
    ]);
    expect(getVoiceDelivery).toHaveBeenCalledExactlyOnceWith('u1', 's1', 'a1');
    expect(records[1].content).toBe('HEARD. More.');
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  } finally {
    await service.operations.shutdown();
  }
});
