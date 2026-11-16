import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { z } from 'zod';
import {
  calendarCredentialAadSchema,
  encryptedCalendarSecretSchema,
  loopbackRedirectSchema,
  sha256Schema,
  type CalendarOAuthState,
  type EncryptedCalendarSecret,
} from '../../contracts/calendar-connections.js';
import { idSchema } from '../../contracts/identifiers.js';
import type { EncryptionBootstrap } from '../config/bootstrap-config.js';
import { AppError } from '../errors/app-error.js';

const UNAVAILABLE = 'Calendar credentials are unavailable.';
const CONTROL = /[\u0000-\u001F\u007F]/;
const PKCE = /^[A-Za-z0-9\-._~]{43,128}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const verifierBindingSchema = z.object({
  userId: idSchema,
  stateHash: sha256Schema,
  browserHash: sha256Schema,
  oidcNonceHash: sha256Schema,
  redirectUri: loopbackRedirectSchema,
}).strict();

const tokenAad = (v: z.infer<typeof calendarCredentialAadSchema>) => Buffer.from(JSON.stringify([
  'aurvin', 'calendar-credential', v.version, v.userId, v.provider, v.connectionId,
  v.credentialVersion, v.googleSubjectId, v.tokenKind,
]), 'utf8');
const verifierAad = (v: Pick<CalendarOAuthState,
  'userId' | 'stateHash' | 'browserHash' | 'oidcNonceHash' | 'redirectUri'>) => Buffer.from(JSON.stringify([
  'aurvin', 'calendar-oauth-pkce', 1, v.userId, v.stateHash, v.browserHash, v.oidcNonceHash, v.redirectUri,
]), 'utf8');

function unavailable(): never {
  throw new AppError('NOT_READY', UNAVAILABLE);
}

export class CalendarSecretCipher {
  private readonly key: KeyObject | null;

  constructor(encryption: EncryptionBootstrap) {
    this.key = encryption.status === 'ready'
      ? createSecretKey(Buffer.from(encryption.key))
      : null;
  }

  sealToken(aad: unknown, plaintext: string): EncryptedCalendarSecret {
    return this.guard(() => this.seal(tokenAad(calendarCredentialAadSchema.parse(aad)), this.assertToken(plaintext)));
  }

  openToken(aad: unknown, envelope: EncryptedCalendarSecret): string {
    return this.guard(() => this.assertToken(this.open(tokenAad(calendarCredentialAadSchema.parse(aad)), envelope)));
  }

  sealVerifier(stateBinding: unknown, plaintext: string): EncryptedCalendarSecret {
    return this.guard(() => this.seal(
      verifierAad(verifierBindingSchema.parse(stateBinding)),
      this.assertVerifier(plaintext),
    ));
  }

  openVerifier(stateBinding: unknown, envelope: EncryptedCalendarSecret): string {
    return this.guard(() => this.assertVerifier(this.open(
      verifierAad(verifierBindingSchema.parse(stateBinding)),
      envelope,
    )));
  }

  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof AppError && error.code === 'NOT_READY' && error.message === UNAVAILABLE) {
        throw error;
      }
      unavailable();
    }
  }

  private requireKey(): KeyObject {
    if (this.key === null) unavailable();
    return this.key;
  }

  private assertToken(value: string): string {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes < 1 || bytes > 8192 || value.trim() !== value || CONTROL.test(value)) unavailable();
    return value;
  }

  private assertVerifier(value: string): string {
    if (!PKCE.test(value)) unavailable();
    return value;
  }

  private canonical(value: string, expectedBytes?: number): Buffer {
    if (!BASE64.test(value)) unavailable();
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) unavailable();
    if (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) unavailable();
    return decoded;
  }

  private seal(aad: Buffer, plaintext: string): EncryptedCalendarSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.requireKey(), iv, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const envelope = encryptedCalendarSecretSchema.parse({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
    this.canonical(envelope.iv, 12);
    this.canonical(envelope.tag, 16);
    this.canonical(envelope.ciphertext);
    return envelope;
  }

  private open(aad: Buffer, envelope: EncryptedCalendarSecret): string {
    const parsed = encryptedCalendarSecretSchema.parse(envelope);
    const iv = this.canonical(parsed.iv, 12);
    const tag = this.canonical(parsed.tag, 16);
    const ciphertext = this.canonical(parsed.ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
