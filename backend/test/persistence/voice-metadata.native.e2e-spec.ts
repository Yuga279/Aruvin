/**
 * ============================================================================
 * FILE: voice-metadata.native.e2e-spec.ts
 * LOCATION: backend/test/persistence/voice-metadata.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Native MongoDB e2e test for VoiceDeliveryRecord persistence and CAS semantics.
 *
 * ROLE IN PROJECT:
 *    Verifies delivery persistence across server reconnects, single CAS winner
 *    under race conditions, and recovery from lost replace acknowledgements.
 *
 * KEY COMPONENTS:
 *    - Reconnect recovery: delivery record availability after client reconnect.
 *    - Concurrent CAS race: exactly one winning compare update.
 *    - Ambiguous ACK recovery: lost ACK after commit is confirmed without error.
 * ============================================================================
 */

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { voiceDeliveryRecordSchema } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { MongoMessages } from '../../src/persistence/messages.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { MongoSessions } from '../../src/persistence/sessions.js';
import { RecordStore } from '../../src/persistence/store.js';
import { attempt, message, session } from './fixtures.js';
import { nativeDatabase } from './native.js';
import { VoiceAccounting } from '../../src/voice/usage/voice-accounting.js';
import { loadVoiceConfig } from '../../src/platform/config/voice-config.js';

const configured = Boolean(process.env.AURVIN_TEST_MONGODB_URI)
  && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_';

describe.skipIf(!configured)('Voice delivery persistence on native MongoDB', () => {
  it('restores delivery evidence after reconnect, wins one CAS and confirms a lost update ACK', async () => {
    const h = await nativeDatabase();
    try {
      const store = new RecordStore(h.db, 15_000);
      const metadata = new MongoMetadata(store, DEFAULT_BUDGETS);
      await new MongoSessions(store, DEFAULT_BUDGETS).createForInternalTurn({ ...session(), latestTurnId: 't1' });
      await new MongoMessages(store, DEFAULT_BUDGETS).append({ ...message(), mode: 'live', visibility: 'internal' });
      await metadata.putAttempt(attempt());
      const first = voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
        turnId: 't1', attemptId: 'a1', status: 'pending', textGenerated: 'Hello. More.' });
      await metadata.putVoiceDelivery(first);
      await metadata.putVoiceDelivery(first);
      const variants = [
        { ...first, sequence: 2, eventId: 'delivery-2a', status: 'interrupted' as const, textSpoken: 'Hello.', textRemaining: ' More.' },
        { ...first, sequence: 2, eventId: 'delivery-2b', status: 'unknown' as const },
      ];
      const won = await Promise.all(variants.map(record => metadata.compareVoiceDelivery(record, 1)));
      expect(won.filter(Boolean)).toHaveLength(1);
      const current = variants[won[0] ? 0 : 1];
      const nextClient = await h.reconnect();
      try {
        const restarted = new MongoMetadata(new RecordStore(nextClient.db(h.name), 15_000), DEFAULT_BUDGETS);
        expect(await restarted.getVoiceDelivery('u1', 's1', 'a1')).toEqual(current);
        expect(await restarted.getVoiceDelivery('u2', 's1', 'a1')).toBeNull();
      } finally { await nextClient.close(); }
      expect(await h.db.collection('metadata').countDocuments({ kind: 'voice-delivery' })).toBe(1);
      await new MongoSessions(store, DEFAULT_BUDGETS).delete('u1', 's1');
      expect(await metadata.getVoiceDelivery('u1', 's1', 'a1')).toEqual(current);

      await metadata.putAttempt({ ...attempt(), attemptId: 'a2', idempotencyKey: 'request-0002', sequence: 2 });
      const second = { ...first, attemptId: 'a2', responseId: 'response-2', eventId: 'delivery-2' };
      await metadata.putVoiceDelivery(second);
      const collection = store.collection('metadata');
      const replace = collection.replaceOne.bind(collection);
      const dbSpy = vi.spyOn(store, 'collection').mockImplementation(name =>
        name === 'metadata' ? collection : h.db.collection(name) as ReturnType<RecordStore['collection']>);
      const ack = vi.spyOn(collection, 'replaceOne').mockImplementationOnce(async (...args) => {
        await replace(...args); throw new Error('ACK lost after commit');
      });
      try {
        const terminal = { ...second, sequence: 2, eventId: 'delivery-3', status: 'interrupted' as const,
          textSpoken: 'Hello.', textRemaining: ' More.' };
        expect(await metadata.compareVoiceDelivery(terminal, 1)).toBe(true);
        expect(await metadata.getVoiceDelivery('u1', 's1', 'a2')).toEqual(terminal);
      } finally { ack.mockRestore(); dbSpy.mockRestore(); }
    } finally { await h.close(); }
  }, 30_000);

  it('restores independent voice accounting after reconnect without a saved conversation', async () => {
      const h = await nativeDatabase();
      try {
        const metadata = new MongoMetadata(new RecordStore(h.db, 15_000), DEFAULT_BUDGETS);
        const ledger = new VoiceAccounting({ userId: 'u1', voiceSessionId: 'voice-1',
          conversationId: () => null, config: loadVoiceConfig({}), write: record => metadata.putVoiceAccounting(record) });
        const entry = await ledger.start('socket-1', 'nova-3');
        const pending = await metadata.getVoiceAccounting('u1', 'voice-1', entry.usageId);
        expect(pending?.status).toBe('pending');
        await entry.finish({ providerRequestId: null, model: 'nova-3', modelVersion: null,
          audioMs: 80, billableCharacters: null }, 'closed', 80);
        await ledger.drain();
        const client = await h.reconnect();
        try {
          const restored = new MongoMetadata(new RecordStore(client.db(h.name), 15_000), DEFAULT_BUDGETS);
          expect(await restored.getVoiceAccounting('u1', 'voice-1', entry.usageId))
            .toMatchObject({ status: 'closed', observedAudioMs: 80, audioMs: null, actualCostUsd: null });
          expect(await restored.getVoiceAccounting('u2', 'voice-1', entry.usageId)).toBeNull();
        } finally { await client.close(); }
      } finally { await h.close(); }
    }, 30_000);
});
