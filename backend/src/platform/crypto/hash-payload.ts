/**
 * ============================================================================
 * FILE: hash-payload.ts
 * LOCATION: backend/src/platform/crypto/hash-payload.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Compute a deterministic SHA-256 digest for submitted payload content.
 *
 * ROLE IN PROJECT:
 *    Supports idempotency payload comparison without storing duplicate raw
 *    request content in attempt metadata.
 *
 * KEY COMPONENTS:
 *    - hashPayload: Returns the UTF-8 payload's lowercase SHA-256 hex digest.
 * ============================================================================
 */

import { createHash } from 'node:crypto';

export function hashPayload(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
