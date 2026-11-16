import { describe, expect, it } from 'vitest';
import { connectionRecordSchema, oauthStateSchema, type CalendarConnectionStore,
  type CalendarCredentialPort, type GoogleIdentityPort } from '../../src/contracts/calendar-connections.js';
import { COLLECTIONS } from '../../src/contracts/collections.js';
const at = '2026-10-20T10:00:00.000Z';
const record = { schemaVersion: 1, userId: 'u', provider: 'google-calendar', connectionId: 'c',
  revision: 1, connectionRevision: 1, credentialVersion: 1, googleSubjectId: 'sub', accountEmail: null,
  calendarId: 'disposable@group.calendar.google.com', targetRevision: 1, enabled: false,
  status: 'disconnected', credentials: null, tokenExpiresAt: null, grantedScopes: [], updatedAt: at };
describe('Calendar connection handoff', () => {
  it('keeps encrypted bounded records separate from singleton config', () => {
    expect(COLLECTIONS.integrationConnections).toBe('integration_connections');
    expect(connectionRecordSchema.parse(record).status).toBe('disconnected');
    expect(connectionRecordSchema.safeParse({ ...record, accessToken: 'raw' }).success).toBe(false);
    expect(connectionRecordSchema.safeParse({ ...record, status: 'connected' }).success).toBe(false);
    const state = { schemaVersion: 1, kind: 'calendar-oauth-state', userId: 'u',
      stateHash: 'a'.repeat(64), browserHash: 'b'.repeat(64), oidcNonceHash: 'c'.repeat(64),
      encryptedVerifier: { version: 1, iv: 'i', tag: 't', ciphertext: 'cipher' },
      redirectUri: 'http://localhost:5173/api/plugins/google-calendar/oauth/callback',
      createdAt: at, expiresAt: '2026-10-20T10:10:00.000Z', consumedAt: null };
    expect(oauthStateSchema.safeParse(state).success).toBe(true);
    expect(oauthStateSchema.safeParse({ ...state, expiresAt: '2026-10-20T10:10:00.001Z' }).success).toBe(false);
    expect(oauthStateSchema.safeParse({ ...state, verifier: 'raw' }).success).toBe(false);
  });
  it('allows independent implementations without another persistence owner', async () => {
    const store: CalendarConnectionStore = { get: async () => null,
      create: async r => ({ outcome: 'confirmed', record: r }),
      compareAndSwap: async (_u, _r, next) => ({ outcome: 'confirmed', record: next }),
      putState: async () => undefined, consumeState: async () => null };
    const credentials: CalendarCredentialPort = { withAccessToken: async () => { throw new Error('Reconnect required'); } };
    const identity: GoogleIdentityPort = { verify: async () => ({ subject: 'verified-sub', email: null }) };
    expect(await store.get('u')).toBeNull();
    expect(await identity.verify({ idToken: 'fixture-only', clientId: 'client',
      expectedNonceHash: 'c'.repeat(64), now: at, signal: new AbortController().signal })).toEqual({ subject: 'verified-sub', email: null });
    expect(credentials.withAccessToken).toBeTypeOf('function');
  });
});
