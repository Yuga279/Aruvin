/**
 * ============================================================================
 * FILE: runtime.spec.ts
 * LOCATION: backend/src/contracts/runtime.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify the submit-turn command carries the bounded Calendar reply reference.
 *
 * ROLE IN PROJECT:
 *    The HTTP submit request already parses an optional proposal revision. The
 *    runtime command must declare the same reference so the parsed body flows
 *    into the runtime without being dropped at the contract boundary.
 *
 * KEY COMPONENTS:
 *    - Submit command tests: Optional reference, preserved value, strict shape.
 * ============================================================================
 */

import { submitTurnRequestSchema } from './api.js';
import { calendarReplyReferenceSchema, type CalendarReplyReference } from './calendar-authority.js';
import { resolvedIdentitySchema, type ResolvedIdentity } from './identity.js';
import type { SubmitTurnCommand } from './runtime.js';

const IDENTITY: ResolvedIdentity = resolvedIdentitySchema.parse({
  userId: 'aurvin-dev-user',
  source: 'server-configured',
  openRouterUser: 'aurvin-dev-user',
});

describe('SubmitTurnCommand', () => {
  it('keeps the optional reply reference absent when the caller sends none', () => {
    const command: SubmitTurnCommand = {
      identity: IDENTITY,
      sessionId: null,
      content: 'Yes, go ahead',
      idempotencyKey: 'idempotency-key-1',
    };
    expect(command.calendarReplyTo).toBeUndefined();
  });

  it('preserves the reply reference the parsed submit request carries', () => {
    const body = submitTurnRequestSchema.parse({
      sessionId: null,
      content: 'Yes, go ahead',
      idempotencyKey: 'idempotency-key-1',
      calendarReplyTo: { proposalId: 'proposal-1', revision: 3 },
    });
    const command: SubmitTurnCommand = { ...body, identity: IDENTITY };
    expect(command.calendarReplyTo).toEqual({ proposalId: 'proposal-1', revision: 3 });
  });

  it('rejects a reply reference with unknown fields or a non-positive revision', () => {
    expect(() => calendarReplyReferenceSchema.parse({ proposalId: 'proposal-1', revision: 3, extra: true }))
      .toThrow();
    expect(() => calendarReplyReferenceSchema.parse({ proposalId: 'proposal-1', revision: 0 })).toThrow();
  });

  it('accepts a strictly parsed reply reference on the command', () => {
    const reference: CalendarReplyReference = calendarReplyReferenceSchema.parse({
      proposalId: 'proposal-1',
      revision: 1,
    });
    const command: SubmitTurnCommand = {
      identity: IDENTITY,
      sessionId: 'session-1',
      content: 'Yes, go ahead',
      idempotencyKey: 'idempotency-key-2',
      calendarReplyTo: reference,
    };
    expect(command.calendarReplyTo?.proposalId).toBe('proposal-1');
    expect(command.calendarReplyTo?.revision).toBe(1);
  });
});
