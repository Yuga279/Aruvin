/**
 * ============================================================================
 * FILE: admission-receipt-reuse.spec.ts
 * LOCATION: backend/test/chat-runtime/admission-receipt-reuse.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit-check pinned checkpoint identity and immutable/sensitive source merge.
 *
 * ROLE IN PROJECT:
 *    Guards Worker 1 helpers so synthetic checkpoint tokens cannot authorize
 *    skipping checkBoundary and so refreshed privacy records replace cached rows.
 *
 * KEY COMPONENTS:
 *    - isPinnedCheckpointId: Rejects empty and `${sessionId}-0` tokens.
 *    - mergeAdmissionSourceRecords: Reuse plain rows; require every manifest ref.
 * ============================================================================
 */
import {
  isPinnedCheckpointId,
  mergeAdmissionSourceRecords,
} from '../../src/chat-runtime/admission-receipt.js';
import type { AgentMemoryManifest } from '../../src/contracts/agent-memory.js';
import type { MessageRecord } from '../../src/contracts/message.js';

const sessionId = 'session-alpha';

it('rejects missing, oversized, and synthetic sessionId-0 checkpoint tokens', () => {
  expect(isPinnedCheckpointId(sessionId, '')).toBe(false);
  expect(isPinnedCheckpointId(sessionId, `${sessionId}-0`)).toBe(false);
  expect(isPinnedCheckpointId(sessionId, 'x'.repeat(129))).toBe(false);
  expect(isPinnedCheckpointId(sessionId, '1ef0c0de-1234-5678-90ab-cdef12345678')).toBe(true);
});

function record(partial: Partial<MessageRecord> & Pick<MessageRecord, 'messageId' | 'eventId' | 'sequence'>): MessageRecord {
  return {
    schemaVersion: 1,
    userId: 'u1',
    sessionId,
    turnId: 'turn-1',
    role: 'user',
    content: 'hello',
    createdAt: '2026-11-02T00:00:00.000Z',
    completionStatus: 'accepted',
    attemptId: null,
    truncated: false,
    ...partial,
  };
}

function manifest(refs: AgentMemoryManifest['messageRefs']): AgentMemoryManifest {
  return {
    schemaVersion: 1,
    userId: 'u1',
    sessionId,
    contextVersion: 0,
    messageRefs: refs,
    sourceRanges: refs.length
      ? [{
          fromSequence: refs[0]!.sequence,
          toSequence: refs.at(-1)!.sequence,
          fromEventId: refs[0]!.eventId,
          toEventId: refs.at(-1)!.eventId,
        }]
      : [],
    activeSummaryRef: null,
    instructionVersion: 'inst',
    knowledgeContentHash: 'know',
    graphSchemaVersion: 'graph',
  };
}

it('reuses plain records, prefers refreshed privacy rows, and refuses missing refs', () => {
  const plain = record({ messageId: 'm-plain', eventId: 'e-plain', sequence: 1 });
  const staleSensitive = record({
    messageId: 'm-cal',
    eventId: 'e-cal',
    sequence: 2,
    role: 'assistant',
    content: 'secret event',
    completionStatus: 'completed',
    attemptId: 'a1',
  });
  const refreshed = record({
    messageId: 'm-cal',
    eventId: 'e-cal',
    sequence: 2,
    role: 'assistant',
    content: '[calendar details expired]',
    completionStatus: 'completed',
    attemptId: 'a1',
  });
  const refs = [
    { messageId: 'm-plain', eventId: 'e-plain', sequence: 1 },
    { messageId: 'm-cal', eventId: 'e-cal', sequence: 2 },
  ];
  const merged = mergeAdmissionSourceRecords(manifest(refs), [plain, staleSensitive], [refreshed]);
  expect(merged?.map(m => m.content)).toEqual(['hello', '[calendar details expired]']);
  expect(mergeAdmissionSourceRecords(manifest(refs), [plain], [])).toBeNull();
  expect(mergeAdmissionSourceRecords(manifest(refs), [plain], [{ ...refreshed, eventId: 'wrong' }])).toBeNull();
});
