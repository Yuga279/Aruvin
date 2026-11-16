/**
 * ============================================================================
 * FILE: voice-metadata.spec.ts
 * LOCATION: backend/test/persistence/voice-metadata.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for VoiceDeliveryRecord persistence in MongoMetadata repository.
 *
 * ROLE IN PROJECT:
 *    Verifies replay/CAS, bounded updates, linkage checks, and idempotency
 *    of speech delivery evidence on the metadata adapter.
 *
 * KEY COMPONENTS:
 *    - putVoiceDelivery: initial pending delivery insertion and idempotency.
 *    - compareVoiceDelivery: monotonic sequence CAS, non-regressing metrics, terminal transitions.
 *    - Validation: linkages to internal live user input, size budget limits.
 * ============================================================================
 */

import type { Db } from 'mongodb';
import { it, expect, vi } from 'vitest';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { messageRecordSchema } from '../../src/contracts/message.js';
import { voiceDeliveryRecordSchema, type VoiceDeliveryRecord } from '../../src/contracts/voice.js';
import { deliveryFixture } from '../../src/contracts/testing/voice-fixtures.js';
import { MongoMetadata } from '../../src/persistence/metadata.js';
import { key, type StoredDocument } from '../../src/persistence/records.js';
import { RecordStore } from '../../src/persistence/store.js';
import { attempt, message } from './fixtures.js';
import { type VoiceAccountingRecord } from '../../src/contracts/voice-accounting.js';

function delivery(overrides: Partial<VoiceDeliveryRecord> = {}): VoiceDeliveryRecord {
  return voiceDeliveryRecordSchema.parse({ ...deliveryFixture(), userId: 'u1', sessionId: 's1',
    turnId: 't1', attemptId: 'a1', status: 'pending', textGenerated: 'Hello. More.', ...overrides });
}
function driver() {
  const collections = new Map<string, Map<string, StoredDocument>>();
  let loseInsert = false;
  let loseReplace = false;
  const db = { collection(name: string) {
    if (!collections.has(name)) collections.set(name, new Map());
    const docs = collections.get(name)!;
    const matches = (d: StoredDocument, f: Record<string, unknown>) =>
      Object.entries(f).every(([k, v]) => d[k] === v);
    return {
      async findOne(filter: Record<string, unknown>) {
        return [...docs.values()].find(d => matches(d, filter)) ?? null;
      },
      async updateOne(filter: Record<string, unknown>, update: { $setOnInsert: StoredDocument }) {
        if (!docs.has(filter._id as string)) docs.set(filter._id as string, update.$setOnInsert);
        if (loseInsert) { loseInsert = false; throw new Error('ACK lost'); }
        return { acknowledged: true, matchedCount: 1 };
      },
      async replaceOne(filter: Record<string, unknown>, doc: StoredDocument) {
        const old = docs.get(filter._id as string);
        if (!old || !matches(old, filter)) return { acknowledged: true, matchedCount: 0 };
        docs.set(doc._id, doc);
        if (loseReplace) { loseReplace = false; throw new Error('ACK lost'); }
        return { acknowledged: true, matchedCount: 1 };
      },
    };
  } };
  return { db: db as unknown as Db, collections,
    loseInsert: () => { loseInsert = true; }, loseReplace: () => { loseReplace = true; } };
}
async function fixture(budgets = DEFAULT_BUDGETS) {
  const io = driver(); const store = new RecordStore(io.db, 1000);
  const metadata = new MongoMetadata(store, budgets);
  await metadata.putAttempt(attempt());
  await store.insert('messages', messageRecordSchema,
    { ...message(), mode: 'live', visibility: 'internal' }, key('message', 'u1', 's1', 'm0'), budgets.maxMessageBytes);
  return { ...io, store, metadata };
}

it('round trips one bounded scoped delivery and confirms ambiguous inserts', async () => {
  const f = await fixture(); const value = delivery();
  f.loseInsert();
  await f.metadata.putVoiceDelivery(value);
  await f.metadata.putVoiceDelivery(value);
  expect(await f.metadata.getVoiceDelivery('u1', 's1', 'a1')).toEqual(value);
  expect(await f.metadata.getVoiceDelivery('u2', 's1', 'a1')).toBeNull();
  expect(await f.metadata.getVoiceDelivery('u1', 'other', 'a1')).toBeNull();
  expect([...f.collections.get('metadata')!.values()].filter(d => d.kind === 'voice-delivery')).toHaveLength(1);
  await expect(f.metadata.putVoiceDelivery(delivery({ responseId: 'other' })))
    .rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' });
});

it('reuses store-bound accepted linkage for live delivery writes without rereading attempt and input', async () => {
  const f = await fixture();
  const confirmedAttempt = await f.metadata.getAttemptConfirmed('u1', 's1', 'a1');
  const input = await f.store.readConfirmed('messages', messageRecordSchema, { _id: key('message', 'u1', 's1', 'm0') });
  if (!confirmedAttempt || !input) throw new Error('Missing fixture evidence');
  const linkage = { attempt: confirmedAttempt, input };
  const read = vi.spyOn(f.store, 'raw');
  await f.metadata.putVoiceDelivery(delivery(), linkage);
  const deliveryId = key('voice-delivery', 'u1', 's1', 'a1');
  expect(read.mock.calls.every(([collection, filter]) => collection === 'metadata' && filter._id === deliveryId)).toBe(true);
  read.mockClear();
  expect(await f.metadata.compareVoiceDelivery(delivery({ sequence: 2, eventId: 'delivery-2' }), 1, linkage)).toBe(true);
  expect(read.mock.calls.every(([collection, filter]) => collection === 'metadata' && filter._id === deliveryId)).toBe(true);
  const other = await fixture();
  await expect(other.metadata.putVoiceDelivery(delivery(), linkage)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.metadata.putVoiceDelivery(delivery({ turnId: 'another-turn' }), linkage))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.metadata.putVoiceDelivery(delivery(), { ...linkage, input: { record: input.record } as typeof input }))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  read.mockRestore();
});

function voiceAccounting(): VoiceAccountingRecord {
  return { schemaVersion: 1, kind: 'voice-accounting', userId: 'u1', sessionId: 'voice-1',
    voiceSessionId: 'voice-1', conversationId: null, usageId: 'socket-1', providerSocketId: 'socket-1',
    userTag: `aurvin-user-${'a'.repeat(64)}`, provider: 'deepgram', model: 'nova-3',
    turnId: null, responseId: null, speechId: null, providerRequestId: null, modelVersion: null,
    status: 'pending', observedAudioMs: null, audioMs: null, billableCharacters: null,
    estimatedCostUsd: null, actualCostUsd: null, startedAt: '2026-10-09T00:00:00.000Z', endedAt: null };
}

it('stores isolated voice accounting before a chat exists, replays lost ACKs and rejects regression', async () => {
  const f = await fixture(); const pending = voiceAccounting();
  f.loseInsert(); await f.metadata.putVoiceAccounting(pending);
  await f.metadata.putVoiceAccounting(pending);
  expect(await f.metadata.getVoiceAccounting('u1', 'voice-1', 'socket-1')).toEqual(pending);
  expect(await f.metadata.getVoiceAccounting('u2', 'voice-1', 'socket-1')).toBeNull();
  expect(await f.metadata.getVoiceAccounting('u1', 'voice-2', 'socket-1')).toBeNull();
  const closed = { ...pending, status: 'closed' as const, observedAudioMs: 80,
    endedAt: '2026-10-09T00:00:01.000Z' };
  f.loseReplace(); await f.metadata.putVoiceAccounting(closed);
  await f.metadata.putVoiceAccounting(closed);
  await expect(f.metadata.putVoiceAccounting(pending)).rejects.toThrow();
  await expect(f.metadata.putVoiceAccounting({ ...closed, observedAudioMs: 40 })).rejects.toThrow();
  await expect(f.metadata.putVoiceAccounting({ ...closed, userTag: `aurvin-user-${'b'.repeat(64)}` })).rejects.toThrow();
  await expect(f.metadata.putVoiceAccounting({ ...closed, audio: [1] } as VoiceAccountingRecord)).rejects.toThrow();
  await expect(f.metadata.putVoiceAccounting({ ...pending, usageId: 'missing', status: 'failed',
    endedAt: closed.endedAt })).rejects.toThrow();
});

it('binds speech accounting to its socket without blocking on delivery lookup and rejects conflicting terminal races', async () => {
  const f = await fixture();
  const socket = { ...voiceAccounting(), model: 'flux-haley-en' };
  await f.metadata.putVoiceAccounting(socket);
  const speech = { ...socket, usageId: 'speech-usage-1', turnId: 't1', responseId: 'response-1', conversationId: 's1' };
  await f.metadata.putVoiceAccounting(speech);
  for (const changed of [{ ...speech, usageId: 'wrong-scope', userId: 'u2' },
    { ...speech, usageId: 'wrong-socket', providerSocketId: 'unbound' }])
    await expect(f.metadata.putVoiceAccounting(changed)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const completed = { ...speech, status: 'completed' as const, speechId: 'dg-speech-1',
    audioMs: 100, billableCharacters: 12, estimatedCostUsd: 0.00018, endedAt: '2026-10-09T00:00:01.000Z' };
  const results = await Promise.allSettled([
    f.metadata.putVoiceAccounting(completed),
    f.metadata.putVoiceAccounting({ ...completed, status: 'interrupted' }),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const restored = new MongoMetadata(f.store, DEFAULT_BUDGETS);
  const saved = await restored.getVoiceAccounting('u1', 'voice-1', 'speech-usage-1');
  expect(saved).toMatchObject({ speechId: 'dg-speech-1', audioMs: 100, billableCharacters: 12 });
  await restored.putVoiceAccounting(saved!);
  await expect(restored.putVoiceAccounting({ ...saved!, billableCharacters: null })).rejects.toThrow();
});

it('updates played evidence with sequence CAS and keeps terminal generated text immutable', async () => {
  const f = await fixture(); const first = delivery();
  await f.metadata.putVoiceDelivery(first);
  const progress = delivery({ sequence: 2, eventId: 'delivery-2', speechId: 'speech-1', audioDurationMs: 2000,
    audioPlayedMs: 500, playedSamples: 12000, textSpoken: 'Hello.', textRemaining: ' More.' });
  expect(await f.metadata.compareVoiceDelivery(progress, 1)).toBe(true);
  expect(await f.metadata.compareVoiceDelivery(progress, 1)).toBe(true);
  const interrupted = { ...progress, sequence: 3, eventId: 'delivery-3', status: 'interrupted' as const };
  f.loseReplace();
  expect(await f.metadata.compareVoiceDelivery(interrupted, 2)).toBe(true);
  expect(await f.metadata.compareVoiceDelivery(interrupted, 2)).toBe(true);
  expect(await f.metadata.getVoiceDelivery('u1', 's1', 'a1')).toEqual(interrupted);
  expect(await f.metadata.compareVoiceDelivery({ ...interrupted, sequence: 4 }, 1)).toBe(false);
  await expect(f.metadata.compareVoiceDelivery({ ...progress, sequence: 4 }, 3))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
});

it('rejects invalid linkage, raw audio, byte overflow and regressing evidence', async () => {
  const f = await fixture();
  await expect(f.metadata.putVoiceDelivery(delivery({ turnId: 'wrong' })))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.metadata.putVoiceDelivery({ ...delivery(), audio: [1, 2] } as VoiceDeliveryRecord))
    .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const small = new MongoMetadata(f.store, { ...DEFAULT_BUDGETS, maxDocumentBytes: 1024 });
  await expect(small.putVoiceDelivery(delivery({ textGenerated: 'x'.repeat(2000) })))
    .rejects.toMatchObject({ code: 'STORAGE_BUDGET_EXCEEDED' });
  const first = delivery({ speechId: 'speech-1', audioDurationMs: 2000, audioPlayedMs: 500,
    playedSamples: 12000, textSpoken: 'Hello.', textRemaining: ' More.' });
  await f.metadata.putVoiceDelivery(first);
  for (const next of [
    { ...first, sequence: 2, audioPlayedMs: 400 },
    { ...first, sequence: 2, playedSamples: 10000 },
    { ...first, sequence: 2, speechId: 'different' },
    { ...first, sequence: 2, providerSocketId: 'different' },
    { ...first, sequence: 2, textGenerated: 'Different', textSpoken: null, textRemaining: null },
    { ...first, sequence: 2, textSpoken: null, textRemaining: null },
  ]) await expect(f.metadata.compareVoiceDelivery({ ...next, eventId: 'delivery-2' }, 1)).rejects.toThrow();
});

it('permits pending generated prefixes and explicit unknown recovery without assuming delivery', async () => {
  const f = await fixture();
  const first = delivery({ textGenerated: 'Hello.' });
  await f.metadata.putVoiceDelivery(first);
  const next = delivery({ sequence: 2, eventId: 'delivery-2' });
  expect(await f.metadata.compareVoiceDelivery(next, 1)).toBe(true);
  const unknown = { ...next, sequence: 3, eventId: 'delivery-3', status: 'unknown' as const };
  expect(await f.metadata.compareVoiceDelivery(unknown, 2)).toBe(true);
  const recovered = { ...unknown, sequence: 4, eventId: 'delivery-4', status: 'interrupted' as const,
    textSpoken: 'Hello.', textRemaining: ' More.' };
  expect(await f.metadata.compareVoiceDelivery(recovered, 3)).toBe(true);
  await expect(f.metadata.compareVoiceDelivery({ ...recovered, sequence: 5, eventId: 'delivery-5',
    textGenerated: 'Hello. More. EXTRA', textRemaining: ' More. EXTRA' }, 4)).rejects.toThrow();
});

it('rejects non-live attempts, inconsistent generated prefixes and unconfirmed completed playback', async () => {
  const f = await fixture();
  const inputId = key('message', 'u1', 's1', 'm0');
  f.collections.get('messages')!.set(inputId, { ...message(), _id: inputId, _revision: 0 });
  await expect(f.metadata.putVoiceDelivery(delivery())).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  f.collections.get('messages')!.set(inputId, { ...message(), visibility: 'internal', mode: 'live',
    _id: inputId, _revision: 0 });
  const first = delivery(); await f.metadata.putVoiceDelivery(first);
  await expect(f.metadata.compareVoiceDelivery({ ...first, sequence: 2,
    textSpoken: 'Not a prefix', textRemaining: null }, 1)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.metadata.compareVoiceDelivery({ ...first, sequence: 2, eventId: 'delivery-2', status: 'completed',
    textSpoken: first.textGenerated, textRemaining: '', audioDurationMs: 2000, audioPlayedMs: 500 }, 1))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  await expect(f.metadata.compareVoiceDelivery({ ...first, sequence: 2, audioDurationMs: 100,
    audioPlayedMs: 101 }, 1)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  await expect(f.metadata.compareVoiceDelivery({ ...first, sequence: 2 }, 1))
    .rejects.toMatchObject({ code: 'CONFLICT_ACTIVE_TURN' });
  expect(await f.metadata.compareVoiceDelivery({ ...first, sequence: 2, eventId: 'delivery-2', status: 'completed',
    textSpoken: first.textGenerated, textRemaining: '', audioDurationMs: 2000, audioPlayedMs: 2000 }, 1)).toBe(true);
});
