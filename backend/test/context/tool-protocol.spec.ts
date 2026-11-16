/**
 * ============================================================================
 * FILE: tool-protocol.spec.ts
 * LOCATION: backend/test/context/tool-protocol.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify fixture-only reconstruction of complete parallel tool call groups.
 *
 * ROLE IN PROJECT:
 *    Preserves AC07 causal grouping without registering tools, fetching payloads,
 *    or expanding production ContextChatMessage with a tool role.
 *
 * KEY COMPONENTS:
 *    - Grouping tests: Assistant calls then matching results despite reverse arrival.
 *    - Rejection tests: Incomplete, orphan, duplicate, cross-scope, external refs.
 * ============================================================================
 */

import { toolRequestRecordSchema, toolResultRecordSchema } from '../../src/contracts/metadata.js';
import { reconstructProtocolFixture } from './tool-protocol.fixture.js';

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

describe('fixture-only tool protocol', () => {
  it('groups assistant requests then matching parallel results despite reverse arrival', () => {
    expect(reconstructProtocolFixture([requestB, requestA], [resultB, resultA])).toEqual([
      { role: 'assistant', content: '', tool_calls: [
        { id: 'call-a', type: 'function', function: { name: 'lookup', arguments: '{"q":"a"}' } },
        { id: 'call-b', type: 'function', function: { name: 'lookup', arguments: '{"q":"b"}' } },
      ] },
      { role: 'tool', tool_call_id: 'call-a', content: '{"answer":"a"}' },
      { role: 'tool', tool_call_id: 'call-b', content: '{"answer":"b"}' },
    ]);
  });
  it.each([
    [], [resultA], [resultA, { ...resultB, sessionId: 's2' }],
    [resultA, { ...resultB, originatingToolRequestEventId: 'req-a' }],
    [resultA, { ...resultB, toolCallId: 'call-a' }],
    [resultA, { ...resultB, sequence: 2 }], [resultA, resultB, resultB],
    [resultA, { ...resultB, resultRef: { storage: 'external' as const, uri: 'https://not-fetched.invalid' } }],
  ].map((results) => ({ results })))('refuses incomplete/orphan/duplicate/cross-scope/external results', ({ results }) => {
    expect(() => reconstructProtocolFixture([requestA, requestB], results)).toThrow('invalid_tool_fixture');
  });
  it('refuses request groups with mixed causal or attempt identity', () => {
    for (const change of [{ attemptId: 'a2' }, { originatingAssistantEventId: 'assistant-2' },
      { toolCallId: 'call-a' }, { argumentsJson: 'not-json' }]) {
      expect(() => reconstructProtocolFixture([requestA, { ...requestB, ...change }], [resultA, resultB]))
        .toThrow('invalid_tool_fixture');
    }
  });
});
