/**
 * ============================================================================
 * FILE: storage.native.e2e-spec.ts
 * LOCATION: backend/test/integration/storage.native.e2e-spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC05 bounded six-collection storage and AC07 tool-group reconstruction.
 *
 * ROLE IN PROJECT:
 *    P10 evidence that ordinary chat stays under document headroom, has no TTL,
 *    and that tool-shaped records reconstruct without registering live tools.
 *
 * KEY COMPONENTS:
 *    - Headroom scan: BSON size plus 256 against conservative document budget.
 *    - reconstructProtocolFixture: Parallel request/result grouping only.
 * ============================================================================
 */

import { BSON } from 'mongodb';
import { CONSERVATIVE_DOCUMENT_HEADROOM_BYTES } from '../../src/contracts/persistence-profile.js';
import { reconstructProtocolFixture } from '../context/tool-protocol.fixture.js';
import { toolRequestRecordSchema, toolResultRecordSchema } from '../../src/contracts/metadata.js';
import { COLLECTIONS, openAssembled, submit, streamText } from './assembled-harness.js';

const nativeIt = process.env.AURVIN_TEST_MONGODB_URI && process.env.AURVIN_TEST_DB_PREFIX === 'aurvin_p2_test_' ? it : it.skip;

nativeIt('AC05 AC07 bound storage and reconstruct tool groups without live tools', async () => {
  const h = await openAssembled();
  try {
    const accepted = await submit(h.agent, 'Storage bounds', 'p10-store-request-1');
    expect(await streamText(h.agent, accepted)).toContain('"type":"completed"');
    const names = Object.values(COLLECTIONS);
    for (const name of names) {
      const collections = await h.db.db.listCollections({ name }).toArray();
      expect(collections.length).toBeGreaterThan(0);
      const docs = await h.db.db.collection(name).find().toArray();
      for (const doc of docs) {
        expect(BSON.calculateObjectSize(doc) + 256).toBeLessThanOrEqual(CONSERVATIVE_DOCUMENT_HEADROOM_BYTES);
      }
      const indexes = await h.db.db.collection(name).indexes();
      for (const index of indexes) {
        expect(index).not.toHaveProperty('expireAfterSeconds');
      }
    }
    const session = await h.db.db.collection(COLLECTIONS.sessions).findOne({ sessionId: accepted.sessionId });
    expect(session).not.toHaveProperty('messages');
    expect(Array.isArray((session as { messages?: unknown })?.messages)).toBe(false);
    expect(session).not.toHaveProperty('attempts');
    const archive = await h.agent.get(`/api/sessions/${accepted.sessionId}/messages`).expect(200);
    const memory = await h.db.db.collection(COLLECTIONS.agentMemory).findOne({ sessionId: accepted.sessionId });
    expect((memory?.messageRefs as unknown[]).length).toBe(archive.body.items.length);
    for (const call of h.calls.filter((item) => item.method === 'POST')) {
      const body = call.body as { tools?: unknown; tool_calls?: unknown };
      expect(body.tools).toBeUndefined();
      expect(JSON.stringify(call.body)).not.toContain('"tool_calls"');
    }
    expect(await h.db.db.collection(COLLECTIONS.metadata).countDocuments({ kind: 'tool-request' })).toBe(0);

    const requestA = toolRequestRecordSchema.parse({
      schemaVersion: 1, kind: 'tool-request', userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
      eventId: 'req-a', sequence: 2, originatingAssistantEventId: 'assistant-1', toolCallId: 'call-a',
      toolName: 'lookup', argumentsJson: '{"q":"a"}', createdAt: '2026-10-06T00:00:00.000Z',
    });
    const requestB = toolRequestRecordSchema.parse({ ...requestA, eventId: 'req-b', sequence: 3,
      toolCallId: 'call-b', argumentsJson: '{"q":"b"}' });
    const resultA = toolResultRecordSchema.parse({
      schemaVersion: 1, kind: 'tool-result', userId: 'u1', sessionId: 's1', turnId: 't1', attemptId: 'a1',
      eventId: 'res-a', sequence: 5, originatingToolRequestEventId: 'req-a', toolCallId: 'call-a',
      outcome: 'ok', resultRef: { storage: 'inline', json: '{"answer":"a"}' },
      createdAt: '2026-10-06T00:00:00.000Z',
    });
    const resultB = toolResultRecordSchema.parse({ ...resultA, eventId: 'res-b', sequence: 4,
      originatingToolRequestEventId: 'req-b', toolCallId: 'call-b',
      resultRef: { storage: 'inline', json: '{"answer":"b"}' } });
    const protocol = reconstructProtocolFixture([requestA, requestB], [resultA, resultB]);
    expect(protocol.filter((item) => item.role === 'tool')).toHaveLength(2);
    expect(protocol.flatMap((item) => item.role === 'assistant' ? item.tool_calls.map((call) => call.id) : [item.tool_call_id])
      .sort()).toEqual(['call-a', 'call-a', 'call-b', 'call-b'].sort());
    expect(() => reconstructProtocolFixture([requestA, requestB], [resultA])).toThrow();
  } finally { await h.close(); }
}, 60000);
