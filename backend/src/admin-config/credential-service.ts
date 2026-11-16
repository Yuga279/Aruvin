/**
 * ============================================================================
 * FILE: credential-service.ts
 * LOCATION: backend/src/admin-config/credential-service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Seal and open write-only provider credentials with AES-256-GCM.
 *
 * ROLE IN PROJECT:
 *    This is the only backend owner that decrypts stored envelopes. Persistence
 *    and HTTP keep ciphertext; runtime receives decrypted keys only in memory.
 *
 * KEY COMPONENTS:
 *    - seal: Fresh 12-byte nonce, provider AAD, canonical base64 envelope.
 *    - decrypt: Strict document parse, authenticated open, candidate re-check.
 *    - validate: Injected non-billable recognition, never returns provider JSON.
 * ============================================================================
 */

import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import {
  credentialUpdateRequestSchema,
  storedConfigDocumentSchema,
  type EncryptedCredentialEnvelope,
  type StoredConfigDocument,
  type StoredCredential,
} from '../contracts/admin-config.js';
import type { CredentialProvider, ManageableSettings } from '../contracts/admin-config-wire.js';
import type { DecryptedCredentials } from '../contracts/config-runtime.js';
import type { EncryptionBootstrap } from '../platform/config/bootstrap-config.js';
import { AdminConfigFault } from './errors.js';

export type CredentialValidatorPort = {
  validate(
    provider: CredentialProvider,
    candidate: string,
    region: ManageableSettings['deepgram']['region'],
  ): Promise<void>;
};

export class CredentialService {
  private readonly key: KeyObject | null;
  private readonly validator: CredentialValidatorPort;

  constructor(encryption: EncryptionBootstrap, validator: CredentialValidatorPort) {
    this.validator = validator;
    this.key = encryption.status === 'ready'
      ? createSecretKey(Buffer.from(encryption.key))
      : null;
  }

  seal(provider: CredentialProvider, candidate: string): EncryptedCredentialEnvelope {
    this.assertReadyKey();
    this.assertCandidate(candidate);
    try {
      const nonce = randomBytes(12);
      const aad = Buffer.from(JSON.stringify(['aurvin', 'config', 1, provider]), 'utf8');
      const cipher = createCipheriv('aes-256-gcm', this.key!, nonce, { authTagLength: 16 });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(candidate, 'utf8'), cipher.final()]);
      return {
        algorithm: 'aes-256-gcm',
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      };
    } catch (error) {
      if (error instanceof AdminConfigFault) throw error;
      throw new AdminConfigFault('CONFIG_ENCRYPTION_UNAVAILABLE');
    }
  }

  decrypt(document: StoredConfigDocument): DecryptedCredentials {
    const parsed = storedConfigDocumentSchema.safeParse(document);
    if (!parsed.success) throw new AdminConfigFault('CONFIG_ENCRYPTION_UNAVAILABLE');
    const stored = parsed.data;
    if (stored.credentials.openrouter === null && stored.credentials.deepgram === null) {
      return { openrouter: null, deepgram: null };
    }
    return {
      openrouter: this.open(stored.credentials.openrouter, 'openrouter'),
      deepgram: this.open(stored.credentials.deepgram, 'deepgram'),
    };
  }

  async validate(
    provider: CredentialProvider,
    candidate: string,
    region: ManageableSettings['deepgram']['region'],
  ): Promise<void> {
    this.assertCandidate(candidate);
    await this.validator.validate(provider, candidate, region);
  }

  private open(stored: StoredCredential | null, provider: CredentialProvider): string | null {
    if (stored === null) return null;
    this.assertReadyKey();
    try {
      const nonce = Buffer.from(stored.envelope.nonce, 'base64');
      const tag = Buffer.from(stored.envelope.tag, 'base64');
      const ciphertext = Buffer.from(stored.envelope.ciphertext, 'base64');
      const aad = Buffer.from(JSON.stringify(['aurvin', 'config', 1, provider]), 'utf8');
      const decipher = createDecipheriv('aes-256-gcm', this.key!, nonce, { authTagLength: 16 });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      return this.assertCandidate(plaintext);
    } catch (error) {
      if (error instanceof AdminConfigFault) throw error;
      throw new AdminConfigFault('CONFIG_ENCRYPTION_UNAVAILABLE');
    }
  }

  private assertReadyKey(): void {
    if (this.key === null) throw new AdminConfigFault('CONFIG_ENCRYPTION_UNAVAILABLE');
  }

  private assertCandidate(candidate: string): string {
    const parsed = credentialUpdateRequestSchema.safeParse({
      protocolVersion: 1,
      expectedRevision: 1,
      action: 'replace',
      candidate,
    });
    if (!parsed.success || parsed.data.action !== 'replace') {
      throw new AdminConfigFault('CONFIG_ENCRYPTION_UNAVAILABLE');
    }
    return parsed.data.candidate;
  }
}
