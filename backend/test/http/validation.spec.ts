/**
 * ============================================================================
 * FILE: validation.spec.ts
 * LOCATION: backend/test/http/validation.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Assert strict HTTP body, query, path, and public-error boundaries.
 *
 * ROLE IN PROJECT:
 *    Locks P6 request parsing so privileged fields, oversized pages, and
 *    private exception text never leak through the chat HTTP surface.
 *
 * KEY COMPONENTS:
 *    - Privileged-field tests: Identity and model override rejection.
 *    - Pagination tests: Scalar limits and opaque cursor bounds.
 *    - Public-error tests: Fixed messages without private payload text.
 * ============================================================================
 */

import { z } from 'zod';
import { DEFAULT_BUDGETS } from '../../src/contracts/budgets.js';
import { submitTurnRequestSchema } from '../../src/contracts/api.js';
import { ServerIdentityResolver } from '../../src/platform/identity/server-identity-resolver.js';
import { RequestIdentityStore } from '../../src/platform/identity/request-identity-store.js';
import { AppError } from '../../src/platform/errors/app-error.js';
import { parseBody, pageQuery, pathId, noQuery } from '../../src/http/validation.js';
import { publicError } from '../../src/http/client-errors.js';
const identity = new ServerIdentityResolver(new RequestIdentityStore());
const base = { sessionId: null, content: 'Hello', idempotencyKey: 'request-0001' };
it('rejects privileged/unknown fields without returning their values', () => {
  for (const [field, code] of [['userId','IDENTITY_OVERRIDE_REJECTED'], ['model','MODEL_OVERRIDE_REJECTED'],
    ['role','UNKNOWN_FIELD'], ['checkpoint','UNKNOWN_FIELD']] as const) {
    expect(() => parseBody(submitTurnRequestSchema, { ...base, [field]: 'secret' }, identity))
      .toThrow(expect.objectContaining({ code }));
  }
  expect(() => parseBody(submitTurnRequestSchema, [], identity)).toThrow();
  expect(() => parseBody(submitTurnRequestSchema, { ...base, content: ' \n\t' }, identity)).toThrow();
});
it('parses only scalar bounded pagination and opaque bounded cursors', () => {
  expect(pageQuery({}, DEFAULT_BUDGETS)).toEqual({ cursor: null, limit: 20 });
  expect(pageQuery({ limit: '2', cursor: 'opaque' }, DEFAULT_BUDGETS)).toEqual({ cursor: 'opaque', limit: 2 });
  for (const q of [{ limit: '0' }, { limit: '51' }, { limit: '1.5' }, { limit: ['2','3'] },
    { limit: '1e1' }, { limit: '' }, { cursor: '' }, { cursor: 'x'.repeat(2049) }, { userId:'other' }]) {
    expect(() => pageQuery(q, DEFAULT_BUDGETS)).toThrow();
  }
  expect(() => pageQuery({ limit: '3' }, { ...DEFAULT_BUDGETS, maxPageSize: 2, defaultPageSize: 2 })).toThrow();
  expect(() => pathId('\n')).toThrow(); expect(() => pathId('x'.repeat(129))).toThrow();
  expect(() => noQuery({ role: 'system' })).toThrow();
});
it('never serializes exception text, causes, Zod issues, keys, or private state', () => {
  const fault = new AppError('PROVIDER_AUTH', 'sk-private private instructions mongodb://u:p@host');
  expect(publicError(fault)).toEqual({ status: 502, body: { code:'PROVIDER_AUTH',
    message:'The model service is unavailable.', retryable:false } });
  expect(publicError(new Error('checkpoint dump sk-private')).body.code).toBe('PERSISTENCE_ERROR');
  const invalid = z.string().safeParse(123);
  if (!invalid.success) expect(publicError(invalid.error).body.code).toBe('INVALID_REQUEST');
  expect(JSON.stringify(publicError(fault))).not.toMatch(/sk-private|instructions|mongodb|stack|cause/i);
});
