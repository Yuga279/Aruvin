/**
 * ============================================================================
 * FILE: archive.spec.ts
 * LOCATION: backend/src/contracts/archive.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify bounded session, visible message, and reference-only memory records.
 *
 * ROLE IN PROJECT:
 *    Protects durable UI history from being collapsed into unbounded session
 *    transcripts and keeps memory manifests linked to original message records.
 *
 * KEY COMPONENTS:
 *    - Session tests: Reject transcript and accumulated ID fields.
 *    - Message tests: Require ordered event identity without private reasoning.
 *    - Memory tests: Require references and bounded source ranges only.
 * ============================================================================
 */

import { agentMemoryManifestSchema } from './agent-memory.js';
import { messageRecordSchema } from './message.js';
import { sessionRecordSchema } from './session.js';

const session = {
  schemaVersion: 1,
  userId: 'aurvin-dev-user',
  sessionId: 'sess_1',
  title: 'Hello',
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  lastActivityAt: '2026-10-06T00:00:00.000Z',
  lifecycle: 'active',
  graphThreadId: 'sess_1',
  execution: {
    ownerId: null,
    leaseExpiresAt: null,
    activeAttemptId: null,
    generation: 0,
  },
  latestTurnId: null,
};

describe('sessionRecordSchema', () => {
  it('accepts bounded metadata without transcript arrays', () => {
    expect(sessionRecordSchema.parse(session).sessionId).toBe('sess_1');
  });

  it('rejects unbounded transcript or id lists on the session document', () => {
    expect(
      sessionRecordSchema.safeParse({ ...session, messages: [] }).success,
    ).toBe(false);
    expect(
      sessionRecordSchema.safeParse({ ...session, messageIds: ['m1'] }).success,
    ).toBe(false);
    expect(
      sessionRecordSchema.safeParse({ ...session, attemptIds: ['a1'] }).success,
    ).toBe(false);
    expect(
      sessionRecordSchema.safeParse({ ...session, transcript: 'hello' }).success,
    ).toBe(false);
  });
});

describe('messageRecordSchema', () => {
  it('requires session/turn/event identity and sequence', () => {
    const message = messageRecordSchema.parse({
      schemaVersion: 1,
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      messageId: 'msg_1',
      eventId: 'evt_1',
      sequence: 0,
      role: 'user',
      content: 'Hello',
      createdAt: '2026-10-06T00:00:00.000Z',
      completionStatus: 'accepted',
      attemptId: null,
      truncated: false,
    });
    expect(message.sequence).toBe(0);
    expect(message.role).toBe('user');
  });

  it('rejects private reasoning fields', () => {
    expect(
      messageRecordSchema.safeParse({
        schemaVersion: 1,
        userId: 'aurvin-dev-user',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        messageId: 'msg_1',
        eventId: 'evt_1',
        sequence: 1,
        role: 'assistant',
        content: 'Hi',
        createdAt: '2026-10-06T00:00:00.000Z',
        completionStatus: 'completed',
        attemptId: 'att_1',
        truncated: false,
        reasoning: 'secret chain of thought',
      }).success,
    ).toBe(false);
  });
});

describe('agentMemoryManifestSchema', () => {
  it('stores references and ranges rather than copied transcript content', () => {
    const manifest = agentMemoryManifestSchema.parse({
      schemaVersion: 1,
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      contextVersion: 1,
      sourceRanges: [
        {
          fromSequence: 0,
          toSequence: 1,
          fromEventId: 'evt_1',
          toEventId: 'evt_2',
        },
      ],
      messageRefs: [
        { messageId: 'msg_1', eventId: 'evt_1', sequence: 0 },
        { messageId: 'msg_2', eventId: 'evt_2', sequence: 1 },
      ],
      activeSummaryRef: null,
      instructionVersion: 'phase1.v1',
      knowledgeContentHash: 'abc',
      graphSchemaVersion: 'phase1.v1',
    });
    expect(manifest.activeSummaryRef).toBeNull();
    expect(manifest.messageRefs[0]).not.toHaveProperty('content');
  });

  it('rejects copied transcript fields', () => {
    expect(
      agentMemoryManifestSchema.safeParse({
        schemaVersion: 1,
        userId: 'aurvin-dev-user',
        sessionId: 'sess_1',
        contextVersion: 1,
        sourceRanges: [],
        messageRefs: [],
        activeSummaryRef: null,
        instructionVersion: 'phase1.v1',
        knowledgeContentHash: 'abc',
        graphSchemaVersion: 'phase1.v1',
        transcript: [{ role: 'user', content: 'copied' }],
      }).success,
    ).toBe(false);
  });
});
