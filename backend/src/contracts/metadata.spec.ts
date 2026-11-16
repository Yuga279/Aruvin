/**
 * ============================================================================
 * FILE: metadata.spec.ts
 * LOCATION: backend/src/contracts/metadata.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify attempt lifecycle, model accounting, and future tool-event contracts.
 *
 * ROLE IN PROJECT:
 *    Protects causal metadata and honest unknown accounting while defining
 *    storage shapes for future tools without enabling tool execution in Phase 1.
 *
 * KEY COMPONENTS:
 *    - Attempt tests: Include lifecycle, idempotency, versions, and attribution.
 *    - Accounting tests: Keep absent provider costs unknown rather than zero.
 *    - Tool group tests: Pair results to their originating request events.
 * ============================================================================
 */

import { attemptRecordSchema } from './attempt.js';
import {
  accountingRecordSchema,
  reconstructToolGroups,
  toolRequestRecordSchema,
  toolResultRecordSchema,
} from './metadata.js';

const attempt = {
  schemaVersion: 1,
  kind: 'attempt',
  userId: 'aurvin-dev-user',
  sessionId: 'sess_1',
  turnId: 'turn_1',
  attemptId: 'att_1',
  idempotencyKey: 'idem_key_1',
  payloadHash: 'a'.repeat(64),
  status: 'accepted',
  sequence: 0,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  instructionVersion: 'phase1.v1',
  knowledgeContentHash: 'abc',
  graphSchemaVersion: 'phase1.v1',
  contextVersion: 1,
  modelId: 'openrouter/test',
  openRouterUser: 'aurvin-dev-user',
  generationId: null,
  truncated: false,
  errorCode: null,
  causal: {
    userMessageId: 'msg_1',
    previousAttemptId: null,
  },
};

describe('attemptRecordSchema', () => {
  it('records lifecycle, idempotency, versions, and OpenRouter user', () => {
    const parsed = attemptRecordSchema.parse(attempt);
    expect(parsed.openRouterUser).toBe('aurvin-dev-user');
    expect(parsed.causal.previousAttemptId).toBeNull();
  });

  it('accepts truncated as a distinct terminal status', () => {
    expect(
      attemptRecordSchema.parse({
        ...attempt,
        status: 'truncated',
        truncated: true,
      }).status,
    ).toBe('truncated');
  });
});

describe('accountingRecordSchema', () => {
  it('keeps missing cost unknown rather than zero', () => {
    const parsed = accountingRecordSchema.parse({
      schemaVersion: 1,
      kind: 'accounting',
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      generationId: 'gen_1',
      requestedModel: 'openrouter/test',
      reportedModel: null,
      reportedProvider: null,
      promptTokens: null,
      completionTokens: null,
      cost: null,
      accountingStatus: 'unknown',
      outcome: 'interrupted',
      startedAt: '2026-10-06T00:00:00.000Z',
      endedAt: null,
    });
    expect(parsed.cost).toBeNull();
    expect(parsed.accountingStatus).toBe('unknown');
  });
});

describe('tool-shaped fixtures', () => {
  it('reconstructs parallel tool groups by toolCallId without enabling live tools', () => {
    const requestA = toolRequestRecordSchema.parse({
      schemaVersion: 1,
      kind: 'tool-request',
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      eventId: 'evt_tool_a',
      sequence: 2,
      originatingAssistantEventId: 'evt_asst_1',
      toolCallId: 'call_a',
      toolName: 'lookup',
      argumentsJson: '{"q":"a"}',
      createdAt: '2026-10-06T00:00:01.000Z',
    });
    const requestB = toolRequestRecordSchema.parse({
      ...requestA,
      eventId: 'evt_tool_b',
      sequence: 3,
      toolCallId: 'call_b',
      argumentsJson: '{"q":"b"}',
    });
    const resultB = toolResultRecordSchema.parse({
      schemaVersion: 1,
      kind: 'tool-result',
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      eventId: 'evt_res_b',
      sequence: 4,
      originatingToolRequestEventId: 'evt_tool_b',
      toolCallId: 'call_b',
      outcome: 'ok',
      resultRef: { storage: 'inline', json: '{"ok":true}' },
      createdAt: '2026-10-06T00:00:02.000Z',
    });
    const resultA = toolResultRecordSchema.parse({
      ...resultB,
      eventId: 'evt_res_a',
      sequence: 5,
      originatingToolRequestEventId: 'evt_tool_a',
      toolCallId: 'call_a',
    });

    const groups = reconstructToolGroups(
      [requestA, requestB],
      [resultB, resultA],
    );
    expect(groups.get('call_a')?.request.eventId).toBe('evt_tool_a');
    expect(groups.get('call_a')?.result?.eventId).toBe('evt_res_a');
    expect(groups.get('call_b')?.result?.eventId).toBe('evt_res_b');
  });

  it('does not attach a result with mismatched request or turn causality', () => {
    const request = toolRequestRecordSchema.parse({
      schemaVersion: 1,
      kind: 'tool-request',
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      eventId: 'evt_tool_a',
      sequence: 2,
      originatingAssistantEventId: 'evt_asst_1',
      toolCallId: 'call_a',
      toolName: 'lookup',
      argumentsJson: '{}',
      createdAt: '2026-10-06T00:00:01.000Z',
    });
    const result = toolResultRecordSchema.parse({
      schemaVersion: 1,
      kind: 'tool-result',
      userId: 'aurvin-dev-user',
      sessionId: 'sess_1',
      turnId: 'turn_2',
      attemptId: 'att_1',
      eventId: 'evt_res_a',
      sequence: 3,
      originatingToolRequestEventId: 'evt_tool_a',
      toolCallId: 'call_a',
      outcome: 'ok',
      resultRef: { storage: 'inline', json: '{}' },
      createdAt: '2026-10-06T00:00:02.000Z',
    });

    expect(reconstructToolGroups([request], [result]).get('call_a')?.result).toBe(
      null,
    );
  });
});
