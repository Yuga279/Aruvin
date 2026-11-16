/**
 * ============================================================================
 * FILE: voice-exclusion.spec.ts
 * LOCATION: backend/test/http/voice-exclusion.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Unit tests for HTTP early mode exclusion during active live voice turns.
 *
 * ROLE IN PROJECT:
 *    Ensures HTTP endpoints return 409 CONFLICT_ACTIVE_TURN early when another tab
 *    owns live voice, without leaking server identity or bypassing runtime checks.
 *
 * KEY COMPONENTS:
 *    - ChatHttpService early reservation check
 *    - Mode exclusion error handling
 * ============================================================================
 */

import { expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { ExecutionReservations } from '../../src/chat-runtime/execution-reservations.js';
import { ChatHttpService } from '../../src/http/chat-http.service.js';
import { fixtureOptions } from './fixtures.js';
import { httpHarness } from './http-harness.js';

it('returns 409 for text submit and retry while another tab owns live voice', async () => {
  const o = fixtureOptions(), identity = o.identity.resolve();
  const reservations = new ExecutionReservations(async () => false);
  const held = await reservations.acquire({ identity, conversationId: 's1',
    owner: { kind: 'live', voiceSessionId: 'v1' } });
  const options = { ...o, executionReservations: reservations }, api = await httpHarness(options);
  try {
    const submit = await supertest(api.url).post('/api/sessions/s1/turns')
      .send({ sessionId: 's1', content: 'Text tab', idempotencyKey: 'text-request-0001' }).expect(409);
    expect(submit.body.code).toBe('CONFLICT_ACTIVE_TURN');
    const retry = await supertest(api.url).post('/api/sessions/s1/turns/t1/retry')
      .send({ idempotencyKey: 'text-retry-0001' }).expect(409);
    expect(retry.body.code).toBe('CONFLICT_ACTIVE_TURN');
    expect(o.runtime.submitTurn).not.toHaveBeenCalled();
    expect(o.runtime.retryTurn).not.toHaveBeenCalled();
    await reservations.release({ identity, reservationId: held.reservationId });
    await new ChatHttpService(options).submit('s1', { sessionId: 's1', content: 'Text tab', idempotencyKey: 'text-request-0001' });
    expect(o.runtime.submitTurn).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});

it('does not leak an identity override through the early mode guard', async () => {
  const o = fixtureOptions(), guard = { assertText: vi.fn() };
  const service = new ChatHttpService({ ...o, executionReservations: guard });
  await expect(service.submit('s1', { sessionId: 's1', content: 'x', idempotencyKey: 'request-0001', userId: 'evil' }))
    .rejects.toMatchObject({ code: 'IDENTITY_OVERRIDE_REJECTED' });
  expect(guard.assertText).not.toHaveBeenCalled();
});
