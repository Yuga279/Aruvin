/**
 * ============================================================================
 * FILE: credential-service.spec.ts
 * LOCATION: backend/src/admin-config/credential-service.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AES-256-GCM credential envelopes, AAD binding, and redaction.
 *
 * ROLE IN PROJECT:
 *    Proves write-only credentials round-trip, reject tampering, and never
 *    leak candidates or cryptographic exception text.
 *
 * KEY COMPONENTS:
 *    - Round-trip tests: Fresh nonce, provider AAD, decrypt of stored docs.
 *    - Tamper tests: Ciphertext/tag/nonce flips and wrong-key failures.
 * ============================================================================
 */

import * as nodeCrypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { EncryptedCredentialEnvelope, StoredConfigDocument } from '../contracts/admin-config.js';
import { defaultManageableSettings } from '../platform/config/manageable-config.js';
import { CredentialService } from './credential-service.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: vi.fn((size: number) => actual.randomBytes(size)),
  };
});

const at = '2026-10-13T12:00:00.000Z';
const secret = 'fixture-secret';
const document = (): StoredConfigDocument => ({
  _id: 'aurvin',
  schemaVersion: 1,
  revision: 1,
  settings: defaultManageableSettings(),
  credentials: { openrouter: null, deepgram: null },
  updatedAt: at,
  updatedBy: 'aurvin-dev-user',
});

function readyService(keyFill = 7) {
  return new CredentialService(
    { status: 'ready', key: Buffer.alloc(32, keyFill) },
    { validate: vi.fn(async () => undefined) },
  );
}

function storedWith(envelope: EncryptedCredentialEnvelope): StoredConfigDocument {
  return {
    ...document(),
    credentials: { openrouter: { envelope, validatedAt: at }, deepgram: null },
  };
}

function flipByte(encoded: string, index = 0): string {
  const buf = Buffer.from(encoded, 'base64');
  buf[index] ^= 0xff;
  return buf.toString('base64');
}

function expectSafeEncryptionFailure(run: () => unknown) {
  try {
    run();
    expect.fail('expected encryption failure');
  } catch (error) {
    expect(error).toMatchObject({ code: 'CONFIG_ENCRYPTION_UNAVAILABLE' });
    const text = `${String(error)}\n${JSON.stringify(error)}\n${(error as Error).stack ?? ''}`;
    expect(text).not.toContain(secret);
    expect(text).not.toContain('Unable to authenticate');
    expect(text).not.toContain('unsupported');
    expect(text.toLowerCase()).not.toContain('bad decrypt');
  }
}

describe('credential service', () => {
  it('binds credentials and uses a fresh nonce', () => {
    const validator = { validate: vi.fn(async () => undefined) };
    const service = new CredentialService({ status: 'ready', key: Buffer.alloc(32, 7) }, validator);
    const a = service.seal('openrouter', 'fixture-secret');
    const b = service.seal('openrouter', 'fixture-secret');
    expect(a.nonce).not.toBe(b.nonce);
    const stored = {
      ...document(),
      credentials: { openrouter: { envelope: a, validatedAt: at }, deepgram: null },
    };
    expect(service.decrypt(stored)).toEqual({ openrouter: 'fixture-secret', deepgram: null });
    expect(() => service.decrypt({
      ...stored,
      credentials: { openrouter: null, deepgram: stored.credentials.openrouter },
    })).toThrowError(expect.objectContaining({ code: 'CONFIG_ENCRYPTION_UNAVAILABLE' }));
    expect(JSON.stringify(a)).not.toContain('fixture-secret');
  });

  it('rejects ciphertext, tag, and nonce bit flips', () => {
    const service = readyService();
    const envelope = service.seal('openrouter', secret);
    expectSafeEncryptionFailure(() => service.decrypt(storedWith({
      ...envelope, ciphertext: flipByte(envelope.ciphertext),
    })));
    expectSafeEncryptionFailure(() => service.decrypt(storedWith({
      ...envelope, tag: flipByte(envelope.tag),
    })));
    expectSafeEncryptionFailure(() => service.decrypt(storedWith({
      ...envelope, nonce: flipByte(envelope.nonce),
    })));
  });

  it('rejects the wrong master key', () => {
    const envelope = readyService(7).seal('openrouter', secret);
    expectSafeEncryptionFailure(() => readyService(9).decrypt(storedWith(envelope)));
  });

  it('rejects unsupported stored schema', () => {
    const service = readyService();
    const envelope = service.seal('openrouter', secret);
    expectSafeEncryptionFailure(() => service.decrypt({
      ...storedWith(envelope),
      schemaVersion: 2,
    } as never));
  });

  it('rejects invalid base64 and tag size', () => {
    const service = readyService();
    const envelope = service.seal('openrouter', secret);
    expectSafeEncryptionFailure(() => service.decrypt(storedWith({
      ...envelope, nonce: '!!!',
    })));
    expectSafeEncryptionFailure(() => service.decrypt(storedWith({
      ...envelope, tag: Buffer.alloc(15, 1).toString('base64'),
    })));
  });

  it('decrypts empty credentials without a master key and rejects secret ops', () => {
    const missing = new CredentialService({ status: 'missing' }, { validate: vi.fn(async () => undefined) });
    const invalid = new CredentialService({ status: 'invalid' }, { validate: vi.fn(async () => undefined) });
    expect(missing.decrypt(document())).toEqual({ openrouter: null, deepgram: null });
    expectSafeEncryptionFailure(() => missing.seal('openrouter', secret));
    expectSafeEncryptionFailure(() => invalid.seal('openrouter', secret));
    const envelope = readyService().seal('openrouter', secret);
    expectSafeEncryptionFailure(() => missing.decrypt(storedWith(envelope)));
  });

  it('rejects oversized, control, and whitespace candidates', () => {
    const service = readyService();
    expectSafeEncryptionFailure(() => service.seal('openrouter', 'a'.repeat(4097)));
    expectSafeEncryptionFailure(() => service.seal('openrouter', 'bad\nkey'));
    expectSafeEncryptionFailure(() => service.seal('openrouter', ' spaced '));
    expectSafeEncryptionFailure(() => service.seal('openrouter', '   '));
  });

  it('replaces random-source failure with a static fault', () => {
    vi.mocked(nodeCrypto.randomBytes).mockImplementationOnce(() => {
      throw new Error(`${secret} rng`);
    });
    expectSafeEncryptionFailure(() => readyService().seal('openrouter', secret));
  });
});
