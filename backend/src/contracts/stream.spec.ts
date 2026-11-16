/**
 * ============================================================================
 * FILE: stream.spec.ts
 * LOCATION: backend/src/contracts/stream.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the versioned application SSE envelope and its terminal outcomes.
 *
 * ROLE IN PROJECT:
 *    Keeps streamed UI events separate from provider/checkpoint internals,
 *    while providing deterministic encode/parse behavior for P6 and P7.
 *
 * KEY COMPONENTS:
 *    - Envelope tests: Require protocol, session, turn, attempt, and sequence.
 *    - SSE tests: Round-trip encoded data frames through strict parsing.
 * ============================================================================
 */

import {
  STREAM_PROTOCOL_VERSION,
  encodeSseFrame,
  parseSseDataLine,
  streamEnvelopeSchema,
} from './stream.js';

const accepted = {
  protocolVersion: 1,
  sessionId: 'sess_1',
  turnId: 'turn_1',
  attemptId: 'att_1',
  sequence: 0,
  event: {
    type: 'turn-accepted',
    userMessageId: 'msg_1',
  },
};

describe('stream protocol', () => {
  it('uses protocol version 1 envelopes with turn/attempt ids', () => {
    expect(STREAM_PROTOCOL_VERSION).toBe(1);
    expect(streamEnvelopeSchema.parse(accepted).event.type).toBe(
      'turn-accepted',
    );
  });

  it('round-trips SSE frames for deltas and terminal completed events', () => {
    const delta = streamEnvelopeSchema.parse({
      ...accepted,
      sequence: 1,
      event: { type: 'delta', text: 'Hello' },
    });
    const completed = streamEnvelopeSchema.parse({
      ...accepted,
      sequence: 2,
      event: {
        type: 'completed',
        assistantMessageId: 'msg_2',
        outcome: 'completed',
      },
    });
    expect(parseSseDataLine(encodeSseFrame(delta))).toEqual(delta);
    expect(parseSseDataLine(encodeSseFrame(completed)).event.type).toBe(
      'completed',
    );
  });

  it('distinguishes truncated, cancelled, and error outcomes from completed', () => {
    expect(
      streamEnvelopeSchema.parse({
        ...accepted,
        event: {
          type: 'status',
          status: 'truncated',
          truncated: true,
        },
      }).event,
    ).toMatchObject({ status: 'truncated', truncated: true });
    expect(
      streamEnvelopeSchema.parse({
        ...accepted,
        event: {
          type: 'error',
          code: 'CANCELLED',
          message: 'Generation was cancelled.',
          retryable: false,
        },
      }).event,
    ).toMatchObject({ code: 'CANCELLED' });
    expect(
      streamEnvelopeSchema.safeParse({
        ...accepted,
        event: { type: 'completed', secretPrompt: 'nope' },
      }).success,
    ).toBe(false);
  });

  it('rejects checkpoint or credential fields on the envelope', () => {
    expect(
      streamEnvelopeSchema.safeParse({
        ...accepted,
        checkpoint: { id: 'cp_1' },
      }).success,
    ).toBe(false);
    expect(
      streamEnvelopeSchema.safeParse({
        ...accepted,
        apiKey: 'sk-secret',
      }).success,
    ).toBe(false);
  });
});
