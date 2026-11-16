import * as nodeCrypto from 'node:crypto';
import { createCipheriv, createSecretKey } from 'node:crypto';
import { CredentialService } from '../../src/admin-config/credential-service.js';
import { defaultManageableSettings } from '../../src/platform/config/manageable-config.js';
import { CalendarSecretCipher } from '../../src/platform/crypto/calendar-secret-cipher.js';
import type { EncryptedCalendarSecret } from '../../src/contracts/calendar-connections.js';
import { oauthState } from './calendar-fixtures.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn((size: number) => actual.randomBytes(size)) };
});

const token = 'fixture-refresh';
const verifier = `${'A'.repeat(43)}`;
const aad = {
  version: 1 as const,
  userId: 'u1',
  provider: 'google-calendar' as const,
  connectionId: 'c1',
  credentialVersion: 1,
  googleSubjectId: 'google-sub1',
  tokenKind: 'refresh' as const,
};
const stateBinding = {
  userId: 'u1',
  stateHash: 'a'.repeat(64),
  browserHash: 'b'.repeat(64),
  oidcNonceHash: 'c'.repeat(64),
  redirectUri: oauthState().redirectUri,
};

function cipher(keyFill = 7) {
  return new CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, keyFill) });
}

function expectUnavailable(run: () => unknown, secret = token) {
  try {
    run();
    expect.fail('expected Calendar credentials to be unavailable');
  } catch (error) {
    expect(error).toMatchObject({ code: 'NOT_READY', message: 'Calendar credentials are unavailable.' });
    const text = `${String(error)}\n${JSON.stringify(error)}\n${(error as Error).stack ?? ''}`;
    expect(text).not.toContain(secret);
    expect(text).not.toContain('Unable to authenticate');
    expect(text).not.toContain('unsupported');
    expect(text.toLowerCase()).not.toContain('bad decrypt');
    expect(text).not.toContain('cause');
  }
}

function flipByte(encoded: string, index = 0): string {
  const buf = Buffer.from(encoded, 'base64');
  buf[index] ^= 0xff;
  return buf.toString('base64');
}

it('binds every credential ownership/version field', () => {
  const secretCipher = new CalendarSecretCipher({ status: 'ready', key: Buffer.alloc(32, 7) });
  const sealed = secretCipher.sealToken(aad, 'fixture-refresh');
  expect(secretCipher.openToken(aad, sealed)).toBe('fixture-refresh');
  expect(secretCipher.sealToken(aad, 'fixture-refresh').iv).not.toBe(sealed.iv);
  for (const patch of [{ userId: 'u2' }, { connectionId: 'c2' }, { credentialVersion: 2 },
    { googleSubjectId: 'google-sub2' }, { tokenKind: 'access' as const }]) {
    expect(() => secretCipher.openToken({ ...aad, ...patch }, sealed)).toThrow('Calendar credentials are unavailable.');
  }
  expect(JSON.stringify(sealed)).not.toContain('fixture-refresh');
});

it('rejects ciphertext, tag, and iv byte flips', () => {
  const sealed = cipher().sealToken(aad, token);
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, ciphertext: flipByte(sealed.ciphertext) }));
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, tag: flipByte(sealed.tag) }));
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, iv: flipByte(sealed.iv) }));
});

it('rejects malformed and noncanonical base64 envelopes', () => {
  const sealed = cipher().sealToken(aad, token);
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, iv: `${sealed.iv}=` }));
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, tag: `${sealed.tag}*` }));
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, ciphertext: `${sealed.ciphertext}=` }));
});

it('rejects 11/13-byte IVs and 15/17-byte tags', () => {
  const sealed = cipher().sealToken(aad, token);
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, iv: Buffer.alloc(11).toString('base64') }));
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, iv: Buffer.alloc(13).toString('base64') }));
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, tag: Buffer.alloc(15).toString('base64') }));
  expectUnavailable(() => cipher().openToken(aad, { ...sealed, tag: Buffer.alloc(17).toString('base64') }));
});

it('rejects wrong, missing, and invalid encryption keys', () => {
  const sealed = cipher(7).sealToken(aad, token);
  expectUnavailable(() => cipher(9).openToken(aad, sealed));
  expectUnavailable(() => new CalendarSecretCipher({ status: 'missing' }).sealToken(aad, token));
  expectUnavailable(() => new CalendarSecretCipher({ status: 'invalid' }).openToken(aad, sealed));
});

it('rejects provider and version mismatches at the AAD schema', () => {
  const sealed = cipher().sealToken(aad, token);
  expectUnavailable(() => cipher().openToken({ ...aad, provider: 'openrouter' as never }, sealed));
  expectUnavailable(() => cipher().openToken({ ...aad, version: 2 as never }, sealed));
});

it('rejects blank, oversized, and control-character tokens', () => {
  expectUnavailable(() => cipher().sealToken(aad, ''));
  expectUnavailable(() => cipher().sealToken(aad, ' token'));
  expectUnavailable(() => cipher().sealToken(aad, 'token '));
  expectUnavailable(() => cipher().sealToken(aad, 'tok\nen'));
  expectUnavailable(() => cipher().sealToken(aad, 'a'.repeat(8193)));
});

it('rejects random-source failure without leaking crypto details', () => {
  vi.mocked(nodeCrypto.randomBytes).mockImplementationOnce(() => {
    throw new Error('Unable to authenticate entropy');
  });
  expectUnavailable(() => cipher().sealToken(aad, token));
});

it('binds PKCE verifier to state, nonce, browser, and redirect', () => {
  const secretCipher = cipher();
  const sealed = secretCipher.sealVerifier(stateBinding, verifier);
  expect(secretCipher.openVerifier(stateBinding, sealed)).toBe(verifier);
  for (const patch of [
    { userId: 'u2' },
    { stateHash: 'd'.repeat(64) },
    { browserHash: 'e'.repeat(64) },
    { oidcNonceHash: 'f'.repeat(64) },
    { redirectUri: 'http://localhost:3000/api/plugins/google-calendar/oauth/callback' },
  ]) {
    expectUnavailable(() => secretCipher.openVerifier({ ...stateBinding, ...patch }, sealed), verifier);
  }
  expectUnavailable(() => secretCipher.sealVerifier(stateBinding, 'short'), 'short');
  expectUnavailable(() => secretCipher.sealVerifier(stateBinding, 'a'.repeat(42)), 'a'.repeat(42));
  expectUnavailable(() => secretCipher.sealVerifier(stateBinding, `${'A'.repeat(42)}+`), `${'A'.repeat(42)}+`);
});

it('rejects token and verifier domain substitution', () => {
  const secretCipher = cipher();
  const tokenEnvelope = secretCipher.sealToken(aad, token);
  const verifierEnvelope = secretCipher.sealVerifier(stateBinding, verifier);
  expectUnavailable(() => secretCipher.openVerifier(stateBinding, tokenEnvelope));
  expectUnavailable(() => secretCipher.openToken(aad, verifierEnvelope), verifier);
});

it('cannot open a legacy config envelope and does not disturb config decrypt', () => {
  const key = Buffer.alloc(32, 7);
  const nonce = Buffer.alloc(12, 3);
  const configAad = Buffer.from(JSON.stringify(['aurvin', 'config', 1, 'openrouter']), 'utf8');
  const configCipher = createCipheriv('aes-256-gcm', createSecretKey(key), nonce, { authTagLength: 16 });
  configCipher.setAAD(configAad);
  const ciphertext = Buffer.concat([configCipher.update('fixture-secret', 'utf8'), configCipher.final()]);
  const legacy = {
    algorithm: 'aes-256-gcm' as const,
    nonce: nonce.toString('base64'),
    tag: configCipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  const service = new CredentialService(
    { status: 'ready', key },
    { validate: vi.fn(async () => undefined) },
  );
  expect(service.decrypt({
    _id: 'aurvin',
    schemaVersion: 1,
    revision: 1,
    settings: defaultManageableSettings(),
    credentials: { openrouter: { envelope: legacy, validatedAt: '2026-10-20T10:00:00.000Z' }, deepgram: null },
    updatedAt: '2026-10-20T10:00:00.000Z',
    updatedBy: 'aurvin-dev-user',
  })).toEqual({ openrouter: 'fixture-secret', deepgram: null });
  const mapped: EncryptedCalendarSecret = {
    version: 1,
    iv: legacy.nonce,
    tag: legacy.tag,
    ciphertext: legacy.ciphertext,
  };
  expectUnavailable(() => cipher().openToken(aad, mapped), 'fixture-secret');
  expectUnavailable(() => cipher().openToken(aad, legacy as never), 'fixture-secret');
});
