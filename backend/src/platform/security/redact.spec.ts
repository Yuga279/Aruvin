/**
 * ============================================================================
 * FILE: redact.spec.ts
 * LOCATION: backend/src/platform/security/redact.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify known secret-bearing values are redacted from objects and strings.
 *
 * ROLE IN PROJECT:
 *    Provides safe logging support without altering ordinary non-secret
 *    application text.
 *
 * KEY COMPONENTS:
 *    - Key-based tests: Redact credential, token, and connection fields.
 *    - Value-based tests: Redact embedded tokens, compact JWTs, and database URIs.
 * ============================================================================
 */

import { redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('redacts API keys, LiveKit secrets, participant tokens, bearer tokens, and Mongo URIs', () => {
    const redacted = redactSecrets({
      OPENROUTER_API_KEY: 'sk-or-v1-secret',
      LIVEKIT_API_KEY: 'APIKey123',
      LIVEKIT_API_SECRET: 'livekit-secret-value',
      participantToken: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2',
      accessToken: 'raw-access-token',
      authorization: 'Bearer abc',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/aurvin',
      roomName: 'aurvin-live-voice-1',
      participantIdentity: 'aurvin-dev-user:voice-1:1',
      message: 'hello',
    }) as Record<string, unknown>;
    expect(redacted.OPENROUTER_API_KEY).toBe('[redacted]');
    expect(redacted.LIVEKIT_API_KEY).toBe('[redacted]');
    expect(redacted.LIVEKIT_API_SECRET).toBe('[redacted]');
    expect(redacted.participantToken).toBe('[redacted]');
    expect(redacted.accessToken).toBe('[redacted]');
    expect(redacted.authorization).toBe('[redacted]');
    expect(redacted.MONGODB_URI).toBe('[redacted]');
    expect(redacted.roomName).toBe('aurvin-live-voice-1');
    expect(redacted.participantIdentity).toBe('aurvin-dev-user:voice-1:1');
    expect(redacted.message).toBe('hello');
  });

  it('redacts secrets and compact JWTs embedded in strings', () => {
    expect(String(redactSecrets('mongodb://u:p@localhost:27017'))).toContain(
      '[redacted]',
    );
    expect(String(redactSecrets('sk-or-v1-abcdef'))).toBe('[redacted]');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJlMTIzNDU2';
    expect(String(redactSecrets(`LiveKit join token=${jwt} failed`))).toBe(
      'LiveKit join token=[redacted] failed',
    );
  });
});
