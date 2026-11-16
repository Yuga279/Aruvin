/**
 * ============================================================================
 * FILE: protocol.test.ts
 * LOCATION: frontend/src/api/protocol.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the client-safe API and stream protocol parsing behavior.
 *
 * ROLE IN PROJECT:
 *    Keeps browser request types aligned with P1 backend contracts and ensures
 *    untrusted SSE frames cannot introduce malformed or private event fields.
 *
 * KEY COMPONENTS:
 *    - Submit validation tests: Reject identity, model, key, and extra fields.
 *    - Stream parser tests: Validate versioned data envelopes and event shapes.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { agenda } from '../features/canvas/testing/calendar-view-fixtures.ts';
import {
  API_ROUTES,
  STREAM_PROTOCOL_VERSION,
  assertNoClientOverrides,
  isSubmitTurnRequest,
  parseSseDataLine,
  isVisibleMessageCanvasArtifacts,
  isTurnStatusResponse,
  isStreamEvent,
} from './protocol.ts';

describe('frontend protocol', () => {
  it('accepts independent save state without relaxing strict generation or identity validation', () => {
    const save = { state: 'saving', epoch: 'boot-1', version: 1, durableVersion: 0 };
    const status = { sessionId: 's1', turnId: 't1', attemptId: 'a1', status: 'completed', truncated: false, error: null };
    expect(isTurnStatusResponse({ ...status, save })).toBe(true);
    expect(isStreamEvent({ type: 'completed', outcome: 'completed', assistantMessageId: 'm1', save })).toBe(true);
    expect(isStreamEvent({ type: 'status', status: 'completed', truncated: false, save })).toBe(true);
    expect(isSubmitTurnRequest({ sessionId: null, content: 'Hi', idempotencyKey: 'request-1', expectedEpoch: 'boot-1' })).toBe(true);
    for (const invalid of [{ ...save, version: -1 }, { ...save, epoch: '' }, { ...save, state: 'durable-ish' }, { ...save, private: true }]) {
      expect(isTurnStatusResponse({ ...status, save: invalid })).toBe(false);
    }
  });
  it('accepts only bounded proposal references on confirmation submissions', () => {
    const request = { sessionId: 'sess_1', content: 'yes', idempotencyKey: 'calendar-confirm-1', calendarProtocol: 2 };
    expect(isSubmitTurnRequest({ ...request, calendarReplyTo: { proposalId: 'proposal_1', revision: 3 } })).toBe(true);
    for (const calendarReplyTo of [null, {}, { proposalId: '', revision: 1 },
      { proposalId: 'proposal_1', revision: 0 }, { proposalId: 'proposal_1', revision: 1.5 },
      { proposalId: 'proposal_1', revision: 1, approved: true }]) {
      expect(isSubmitTurnRequest({ ...request, calendarReplyTo })).toBe(false);
    }
  });
  it('matches backend stream protocol version 1', () => {
    expect(STREAM_PROTOCOL_VERSION).toBe(1);
    const frame =
      'data: {"protocolVersion":1,"sessionId":"sess_1","turnId":"turn_1","attemptId":"att_1","sequence":1,"event":{"type":"delta","text":"Hello"}}\n\n';
    expect(parseSseDataLine(frame)).toEqual({
      protocolVersion: 1,
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      sequence: 1,
      event: { type: 'delta', text: 'Hello' },
    });
  });

  it('rejects client identity and model fields on submit requests', () => {
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Hello',
        idempotencyKey: 'idempotency-key-1',
      }),
    ).toBe(true);
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Hello',
        idempotencyKey: 'idempotency-key-1',
        userId: 'hacker',
      }),
    ).toBe(false);
    expect(() =>
      assertNoClientOverrides({ userId: 'hacker', content: 'Hello' }),
    ).toThrowError(/identity/i);
    expect(() => assertNoClientOverrides({ model: 'other' })).toThrowError(
      /model/i,
    );
  });

  it('rejects invalid bounds and unknown submit properties', () => {
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Hello',
        idempotencyKey: 'short',
      }),
    ).toBe(false);
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'x'.repeat(32_001),
        idempotencyKey: 'idempotency-key-1',
      }),
    ).toBe(false);
  });

  it('rejects malformed stream events and unknown envelope fields', () => {
    const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const envelope = {
      protocolVersion: 1,
      sessionId: 'sess_1',
      turnId: 'turn_1',
      attemptId: 'att_1',
      sequence: 1,
      event: { type: 'delta', text: 'Hello' },
    };
    expect(() =>
      parseSseDataLine(frame({ ...envelope, event: { type: 'delta' } })),
    ).toThrow(/invalid_stream_envelope/i);
    expect(() =>
      parseSseDataLine(frame({ ...envelope, checkpoint: { id: 'private' } })),
    ).toThrow(/invalid_stream_envelope/i);
    expect(() =>
      parseSseDataLine(frame({ ...envelope, sequence: -1 })),
    ).toThrow(/invalid_stream_envelope/i);
  });

  it('exposes the same resource paths P6 will serve', () => {
    expect(API_ROUTES.sessions).toBe('/sessions');
    expect(API_ROUTES.turnStream('sess_1', 'turn_1')).toBe(
      '/sessions/sess_1/turns/turn_1/stream',
    );
    expect(API_ROUTES.retryTurn('sess_1', 'turn_1')).toBe(
      '/sessions/sess_1/turns/turn_1/retry',
    );
  });

  it('accepts optional calendarProtocol: 2 on submit and retry requests and rejects invalid versions or Calendar overrides', () => {
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Schedule sync',
        idempotencyKey: 'idempotency-key-1',
        calendarProtocol: 2,
      }),
    ).toBe(true);
    expect(
      isSubmitTurnRequest({
        sessionId: null,
        content: 'Schedule sync',
        idempotencyKey: 'idempotency-key-1',
        calendarProtocol: 1 as unknown as 2,
      }),
    ).toBe(false);
    expect(() =>
      assertNoClientOverrides({ calendarId: 'primary', content: 'Hello' }),
    ).toThrowError(/Identity, model, and API keys/i);
    expect(() =>
      assertNoClientOverrides({ accessToken: 'tok', content: 'Hello' }),
    ).toThrowError(/Identity, model, and API keys/i);
  });

  it('validates visible message canvas artifacts field correctly', () => {
    // Absent legacy field is accepted
    expect(isVisibleMessageCanvasArtifacts({ role: 'assistant', mode: 'live', voiceSessionId: 'voice-1' })).toBe(true);
    expect(isVisibleMessageCanvasArtifacts({ role: 'user', content: 'Hi' })).toBe(true);
    expect(isVisibleMessageCanvasArtifacts('not a record')).toBe(false);

    const validVisual = {
      responseId: 'response-1',
      ordinal: 0,
      kind: 'mermaid',
      subType: 'Flowchart',
      title: 'Approval path',
      rawSource: 'flowchart TD\nA --> B',
    };

    // Valid assistant/live accepted
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'live',
      voiceSessionId: 'voice-1',
      canvasArtifacts: [validVisual],
    })).toBe(true);

    // Rejected if role is not assistant or mode is not live or invalid voiceSessionId
    expect(isVisibleMessageCanvasArtifacts({
      role: 'user',
      mode: 'live',
      voiceSessionId: 'voice-1',
      canvasArtifacts: [validVisual],
    })).toBe(false);
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'text',
      voiceSessionId: 'voice-1',
      canvasArtifacts: [validVisual],
    })).toBe(false);
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'live',
      voiceSessionId: 'bad id',
      canvasArtifacts: [validVisual],
    })).toBe(false);

    // Rejected if canvasArtifacts is null, empty array, mixed response, duplicate ordinals, descending, excess count
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'live',
      voiceSessionId: 'voice-1',
      canvasArtifacts: null,
    })).toBe(false);
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'live',
      voiceSessionId: 'voice-1',
      canvasArtifacts: [],
    })).toBe(false);
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'live',
      voiceSessionId: 'voice-1',
      canvasArtifacts: [validVisual, { ...validVisual, responseId: 'response-2', ordinal: 1 }],
    })).toBe(false);
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'live',
      voiceSessionId: 'voice-1',
      canvasArtifacts: [validVisual, { ...validVisual, ordinal: 0 }],
    })).toBe(false);
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'live',
      voiceSessionId: 'voice-1',
      canvasArtifacts: [{ ...validVisual, ordinal: 1 }, { ...validVisual, ordinal: 0 }],
    })).toBe(false);
    expect(isVisibleMessageCanvasArtifacts({
      role: 'assistant',
      mode: 'live',
      voiceSessionId: 'voice-1',
      canvasArtifacts: [
        { ...validVisual, ordinal: 0 },
        { ...validVisual, ordinal: 1 },
        { ...validVisual, ordinal: 2 },
        { ...validVisual, ordinal: 3 },
      ],
    })).toBe(false);
  });

  it('accepts a completed Calendar snapshot without changing completion/save semantics', () => {
    expect(isStreamEvent({type:'completed',assistantMessageId:'m',outcome:'completed',calendarView:agenda()})).toBe(true);
    expect(isStreamEvent({type:'completed',assistantMessageId:'m',outcome:'completed',calendarView:{kind:'agenda'}})).toBe(false);
  });
});
