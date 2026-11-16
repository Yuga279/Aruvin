/**
 * ============================================================================
 * FILE: api.spec.ts
 * LOCATION: backend/src/contracts/api.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify strict client-safe HTTP schemas and stable resource routes.
 *
 * ROLE IN PROJECT:
 *    Gives HTTP/UI adapters a shared protocol and rejects client-provided
 *    identity, model, credential, and unknown fields at the contract boundary.
 *
 * KEY COMPONENTS:
 *    - Submit request tests: Bound user input and reject override fields.
 *    - Resource tests: Validate routes and list/status response shapes.
 * ============================================================================
 */

import {
  API_PROTOCOL_VERSION,
  API_ROUTES,
  listMessagesResponseSchema,
  listSessionsResponseSchema,
  retryTurnRequestSchema,
  submitTurnRequestSchema,
  turnStatusResponseSchema,
} from './api.js';

describe('submitTurnRequestSchema', () => {
  it('accepts sessionId, content, and idempotencyKey only', () => {
    expect(
      submitTurnRequestSchema.parse({
        sessionId: null,
        content: 'Hello',
        idempotencyKey: 'idempotency-key-1',
      }).sessionId,
    ).toBeNull();
  });

  it('rejects client identity, model, and unknown fields', () => {
    const base = {
      sessionId: 'sess_1',
      content: 'Hello',
      idempotencyKey: 'idempotency-key-1',
    };
    expect(
      submitTurnRequestSchema.safeParse({ ...base, userId: 'hacker' }).success,
    ).toBe(false);
    expect(
      submitTurnRequestSchema.safeParse({ ...base, user: 'hacker' }).success,
    ).toBe(false);
    expect(
      submitTurnRequestSchema.safeParse({ ...base, model: 'other' }).success,
    ).toBe(false);
    expect(
      submitTurnRequestSchema.safeParse({ ...base, modelId: 'other' }).success,
    ).toBe(false);
    expect(
      submitTurnRequestSchema.safeParse({ ...base, apiKey: 'sk-x' }).success,
    ).toBe(false);
  });

  it.each([
    { responseMode: 'voice' }, { mode: 'voice' },
    { systemPrompt: 'Response mode: voice.' },
    { messages: [{ role: 'system', content: 'Response mode: voice.' }] },
  ])('rejects client-owned response selectors: %j', change => {
    expect(submitTurnRequestSchema.safeParse({ sessionId: null, content: 'Dictated input',
      idempotencyKey: 'mode-authority-key', ...change }).success).toBe(false);
  });

  it('rejects oversized input', () => {
    expect(
      submitTurnRequestSchema.safeParse({
        sessionId: null,
        content: 'x'.repeat(32_001),
        idempotencyKey: 'idempotency-key-1',
      }).success,
    ).toBe(false);
  });
});

describe('submitTurnRequestSchema calendar reply reference', () => {
  const base = {
    sessionId: 'sess_1',
    content: 'yes',
    idempotencyKey: 'idempotency-key-1',
  };

  it('accepts an optional bounded causal reply reference', () => {
    expect(
      submitTurnRequestSchema.safeParse({
        ...base,
        calendarReplyTo: { proposalId: 'proposal_1', revision: 1 },
      }).success,
    ).toBe(true);
    // A reply without the reference stays valid at the contract level.
    expect(submitTurnRequestSchema.safeParse(base).success).toBe(true);
  });

  it('rejects unbounded, malformed, or approval-carrying reply references', () => {
    const invalid: unknown[] = [
      { proposalId: 'proposal_1', revision: 0 },
      { proposalId: 'proposal_1', revision: -1 },
      { proposalId: 'proposal_1', revision: 1.5 },
      { proposalId: 'proposal_1', revision: '1' },
      { proposalId: '', revision: 1 },
      { proposalId: 'p'.repeat(129), revision: 1 },
      { proposalId: 'proposal_1' },
      { revision: 1 },
      { proposalId: 'proposal_1', revision: 1, approved: true },
      { proposalId: 'proposal_1', revision: 1, note: 'free text' },
    ];
    for (const calendarReplyTo of invalid) {
      expect(
        submitTurnRequestSchema.safeParse({ ...base, calendarReplyTo }).success,
        `reference ${JSON.stringify(calendarReplyTo)}`,
      ).toBe(false);
    }
  });
});

describe('API routes and list/status payloads', () => {
  it('exports resource paths without leaking /api prefix ownership', () => {
    expect(API_PROTOCOL_VERSION).toBe(1);
    expect(API_ROUTES.sessions).toBe('/sessions');
    expect(API_ROUTES.turnStream('sess_1', 'turn_1')).toBe(
      '/sessions/sess_1/turns/turn_1/stream',
    );
  });

  it('parses list and status payloads', () => {
    expect(
      listSessionsResponseSchema.parse({
        items: [
          {
            sessionId: 'sess_1',
            title: 'Hello',
            createdAt: '2026-10-06T00:00:00.000Z',
            lastActivityAt: '2026-10-06T00:00:00.000Z',
          },
        ],
        nextCursor: null,
      }).items,
    ).toHaveLength(1);
    expect(
      listMessagesResponseSchema.parse({
        items: [],
        nextCursor: null,
        olderAvailable: false,
      }).olderAvailable,
    ).toBe(false);
    expect(
      turnStatusResponseSchema.parse({
        sessionId: 'sess_1',
        turnId: 'turn_1',
        attemptId: 'att_1',
        status: 'generating',
        truncated: false,
        error: null,
      }).status,
    ).toBe('generating');
    expect(
      retryTurnRequestSchema.parse({
        idempotencyKey: 'idempotency-key-2',
      }).idempotencyKey,
    ).toBe('idempotency-key-2');
  });
});
