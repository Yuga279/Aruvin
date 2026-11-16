/**
 * ============================================================================
 * FILE: voice-history.spec.ts
 * LOCATION: backend/test/runtime/voice-history.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for history archive paging and terminal live attempt eligibility.
 *
 * ROLE IN PROJECT:
 *    Ensures raw context paging uses listForContext and includes terminal live
 *    assistant attempts in context assembly without leaking public messages.
 *
 * KEY COMPONENTS:
 *    - acceptedHistory: Marker-filtered and terminal live history selection.
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import { acceptedHistory } from '../../src/chat-runtime/history.js';
import type { PersistenceBundle } from '../../src/persistence/persistence.js';
import type { MessageRecord } from '../../src/contracts/message.js';
import { attempt, message } from '../persistence/fixtures.js';

it('uses original paging and retains heard-context candidates for terminal live attempts', async () => {
  const input = { ...message(0), visibility: 'internal' as const, mode: 'live' as const };
  const assistant: MessageRecord = { ...message(2), role: 'assistant', visibility: 'internal', mode: 'live',
    completionStatus: 'cancelled' as const, content: 'Hello. Unheard.', attemptId: 'a1' };
  const a = { ...attempt(), status: 'cancelled' as const };
  const list = vi.fn(async () => { throw new Error('Public paging is forbidden here'); });
  const p = { messages: { budgets: { maxPageSize: 50 }, list,
    listForContext: vi.fn(async () => ({ items: [input, assistant], nextCursor: null })) },
    metadata: { budgets: { maxPageSize: 50 }, listAttempts: vi.fn(async () => ({ items: [a], nextCursor: null })),
      getAcceptance: vi.fn(async () => ({ turnId: a.turnId, userMessageId: input.messageId, payloadHash: a.payloadHash })) },
  } as unknown as PersistenceBundle;
  expect((await acceptedHistory(p, 'u1', 's1')).map(m => m.role)).toEqual(['user', 'assistant']);
  expect(list).not.toHaveBeenCalled();
  assistant.visibility = 'visible'; assistant.mode = 'text';
  expect((await acceptedHistory(p, 'u1', 's1')).map(m => m.role)).toEqual(['user']);
});

it('excludes visible voice-summary messages without attempts from context assembly', async () => {
  const input = { ...message(0), visibility: 'internal' as const, mode: 'live' as const };
  const voiceSummary: MessageRecord = {
    ...message(3),
    role: 'assistant',
    visibility: 'visible',
    mode: 'live',
    attemptId: null,
    voiceSessionId: 'voice-1',
    voiceDurationSeconds: 5,
    voiceTranscripts: [{ role: 'user', content: 'hello' }],
  };
  const a = { ...attempt(), status: 'completed' as const };
  const p = {
    messages: {
      budgets: { maxPageSize: 50 },
      listForContext: vi.fn(async () => ({ items: [input, voiceSummary], nextCursor: null })),
    },
    metadata: {
      budgets: { maxPageSize: 50 },
      listAttempts: vi.fn(async () => ({ items: [a], nextCursor: null })),
      getAcceptance: vi.fn(async () => ({ turnId: a.turnId, userMessageId: input.messageId, payloadHash: a.payloadHash })),
    },
  } as unknown as PersistenceBundle;
  const history = await acceptedHistory(p, 'u1', 's1');
  expect(history.map(m => m.messageId)).toEqual([input.messageId]);
  expect(history.some(m => m.messageId === voiceSummary.messageId)).toBe(false);
});

it('retains original message reference for each terminal live outcome with empty content and valid artifact', async () => {
  const visual = {
    responseId: 'resp-1',
    ordinal: 0,
    kind: 'mermaid' as const,
    subType: 'Flowchart',
    title: 'Approval path',
    rawSource: 'flowchart TD\nA --> B',
  };
  for (const status of ['completed', 'truncated', 'cancelled', 'interrupted', 'failed'] as const) {
    const input = { ...message(0), visibility: 'internal' as const, mode: 'live' as const };
    const assistant: MessageRecord = {
      ...message(2),
      role: 'assistant',
      visibility: 'internal',
      mode: 'live',
      completionStatus: status,
      content: '',
      attemptId: 'a1',
      canvasArtifacts: [visual],
    };
    const a = { ...attempt(), status };
    const p = {
      messages: {
        budgets: { maxPageSize: 50 },
        listForContext: vi.fn(async () => ({ items: [input, assistant], nextCursor: null })),
      },
      metadata: {
        budgets: { maxPageSize: 50 },
        listAttempts: vi.fn(async () => ({ items: [a], nextCursor: null })),
        getAcceptance: vi.fn(async () => ({ turnId: a.turnId, userMessageId: input.messageId, payloadHash: a.payloadHash })),
      },
    } as unknown as PersistenceBundle;
    const history = await acceptedHistory(p, 'u1', 's1');
    expect(history.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(history[1].canvasArtifacts).toEqual([visual]);
  }
});
