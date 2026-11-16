/**
 * ============================================================================
 * FILE: identity.spec.ts
 * LOCATION: backend/test/runtime/identity.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify deterministic session/attempt identities and bounded Unicode titles.
 *
 * ROLE IN PROJECT:
 *    Locks P5 request identity recipes so new chats, retries, and titles stay
 *    scoped, idempotent, and free of surrogate halves or control characters.
 *
 * KEY COMPONENTS:
 *    - Identity tests: Duplicate new-chat keys without hashing content.
 *    - Title tests: Control-character stripping and grapheme-safe truncation.
 * ============================================================================
 */

import { sessionIdFor, attemptIdFor, inputId, titleFor } from '../../src/chat-runtime/identity.js';
it('deduplicates new-chat identity without hashing content into request identity', () => {
  expect(sessionIdFor('u', null, 'request-0001')).toBe(sessionIdFor('u', null, 'request-0001'));
  expect(sessionIdFor('u', null, 'request-0001')).not.toBe(sessionIdFor('v', null, 'request-0001'));
  expect(sessionIdFor('u', 'existing', 'request-0001')).toBe('existing');
  expect(attemptIdFor('u', 's', 'request-0001')).not.toBe(attemptIdFor('u', 's', 'request-0002'));
  expect(inputId('u', 's', 'a')).toHaveLength(64);
});
it('does not leave surrogate halves or control characters in bounded titles', () => {
  expect(titleFor('  Hello\nworld\u0000  ', 80)).toBe('Hello world');
  expect(titleFor('😀😀', 3)).toBe('😀');
  expect(titleFor('\u0000\n', 80)).toBe('New chat');
});
