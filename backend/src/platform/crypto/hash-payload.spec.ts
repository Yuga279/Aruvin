/**
 * ============================================================================
 * FILE: hash-payload.spec.ts
 * LOCATION: backend/src/platform/crypto/hash-payload.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify stable SHA-256 hashing for accepted payload identity.
 *
 * ROLE IN PROJECT:
 *    Provides deterministic idempotency comparison without persisting raw
 *    duplicate payload copies in attempt metadata.
 *
 * KEY COMPONENTS:
 *    - hashPayload tests: Verify known digest, stability, and content sensitivity.
 * ============================================================================
 */

import { hashPayload } from './hash-payload.js';

describe('hashPayload', () => {
  it('returns a stable SHA-256 hex digest', () => {
    expect(hashPayload('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(hashPayload('hello')).toBe(hashPayload('hello'));
    expect(hashPayload('hello')).not.toBe(hashPayload('Hello'));
  });
});
