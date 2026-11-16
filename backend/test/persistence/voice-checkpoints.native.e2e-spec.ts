/**
 * ============================================================================
 * FILE: voice-checkpoints.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/voice-checkpoints.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Native MongoDB e2e test for checkpoint recovery and context heard-content consistency.
 *
 * ROLE IN PROJECT:
 *    Proves that stock checkpoint saver preserves generated assistant output
 *    without mutating or leaking it into context, and ensures stale writers are fenced.
 *
 * KEY COMPONENTS:
 *    - Checkpoint restoration: LangGraph checkpointer restores original saved result.
 *    - Context assembly: Corrected spoken text assembled afresh from delivery snapshot.
 *    - Lease fencing: Released/stale lease rejects both delivery CAS and checkpoint writes.
 * ============================================================================
 */

import { emptyCheckpoint } from '@langchain/langgraph-checkpoint';
import { describe, it, expect } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { ReferencedContextAssembler } from '../../src/context/referenced-context-assembler.js';
import { buildReferenceManifest } from '../../src/context/reference-selection.js';
import { createPersistenceBundle } from '../../src/persistence/persistence.js';
import { MongoCheckpointFactory } from '../../src/persistence/checkpoints.js';
import { MongoMemory } from '../../src/persistence/memory.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { graphThreadId } from '../../src/persistence/records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { assets, request } from '../context/fixtures.js';
import { attempt, message, session } from './fixtures.js';
import { nativeDatabase } from './native.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Voice checkpoint recovery on native MongoDB', () => {
  it('restores original graph evidence but assembles corrected internal history once and fences stale writers', async () => {
    const h = await nativeDatabase();
    try {
      const p = await createPersistenceBundle(h.client, h.name, DEFAULT_BUDGETS, 'voice-process');
      try {
      await p.sessions.createForInternalTurn({ ...session(), latestTurnId: 't1' });
      const acquired = await p.owner.acquire({ userId: 'u1', sessionId: 's1', ownerId: 'voice-process', leaseMs: 60_000 });
      if (!acquired.ok) throw new Error('expected lease');
      const lease = acquired.lease;
      const records = [
        { ...message(0), mode: 'live' as const, visibility: 'internal' as const },
        { ...message(2), mode: 'live' as const, visibility: 'internal' as const, content: 'Hello. More.' },
        { ...message(3), role: 'user' as const, completionStatus: 'accepted' as const,
          attemptId: null, turnId: request.turnId, content: request.newUserInput,
          mode: 'live' as const, visibility: 'internal' as const },
      ];
      const memory = buildReferenceManifest('u1', 's1', 1, records, assets, DEFAULT_BUDGETS);
      await p.owner.run(lease, async () => {
        for (const record of records) await p.messages.append(record);
        await p.metadata.putAttempt(attempt());
        await p.memory.put(memory);
      });
      const initial = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
        turnId: 't1', attemptId: 'a1', status: 'pending', textGenerated: 'Hello. More.' });
      await p.owner.run(lease, () => p.metadata.putVoiceDelivery(initial));
      const saver = (await p.checkpoints.create()).bind(lease);
      const checkpoint = emptyCheckpoint();
      checkpoint.channel_values = { result: { assistant: records[1], target: memory }, sealed: true };
      const cfg = { configurable: { thread_id: graphThreadId('u1', 's1'), checkpoint_ns: '' } };
      const saved = await saver.put(cfg, checkpoint, { source: 'update', step: 1, parents: {} });
      const interrupted = { ...initial, sequence: 2, eventId: 'delivery-2', status: 'interrupted' as const,
        textSpoken: 'Hello.', textRemaining: ' More.' };
      expect(await p.owner.run(lease, () => p.metadata.compareVoiceDelivery(interrupted, 1))).toBe(true);
      const other = await h.reconnect();
      try {
        const store = new RecordStore(other.db(h.name), 15_000);
        const restoredSaver = (await new MongoCheckpointFactory(other, h.name, p.owner, DEFAULT_BUDGETS).create()).bind(lease);
        const restored = await restoredSaver.getTuple(saved);
        expect(restored?.checkpoint.channel_values.result).toEqual({ assistant: records[1], target: memory });
        const assembler = new ReferencedContextAssembler({ assets, budgets: DEFAULT_BUDGETS,
          memory: new MongoMemory(store, DEFAULT_BUDGETS), messages: new MongoMessages(store, DEFAULT_BUDGETS),
          metadata: new MongoMetadata(store, DEFAULT_BUDGETS) });
        const result = await assembler.assemble(request);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected context');
        expect(result.context.messages.slice(3)).toEqual([
          { role: 'system', content: 'Response mode: text.' },
          { role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello.' },
          { role: 'user', content: request.newUserInput },
        ]);
        expect(await p.memory.get('u1', 's1')).toEqual(memory);
        expect((await p.messages.get('u1', 's1', 'm2'))?.content).toBe('Hello. More.');
        expect((await p.messages.list('u1', 's1', { cursor: null, limit: 20 })).items).toEqual([]);
      } finally { await other.close(); }
      await p.owner.release(lease);
      await expect(p.owner.run(lease, () => p.metadata.compareVoiceDelivery({ ...interrupted, sequence: 3 }, 2)))
        .rejects.toMatchObject({ code: 'INTERRUPTED' });
      await expect(saver.put(cfg, checkpoint, { source: 'update', step: 2, parents: {} }))
        .rejects.toMatchObject({ code: 'INTERRUPTED' });
      } finally { await p.owner.releaseExecutor(); }
    } finally { await h.close(); }
  }, 30_000);
});
