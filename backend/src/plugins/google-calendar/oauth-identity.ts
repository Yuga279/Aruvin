import {
  constants,
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from 'node:crypto';
import type { GoogleIdentityPort } from '../../contracts/calendar-connections.js';
import { CALENDAR_LIMITS } from '../../contracts/calendar-policy.js';
import { scanJsonObject } from '../../model/strict-json.js';
import { toolFault } from './tools-validation.js';
import { oauthRequest } from './oauth-http.js';
import { GOOGLE_OAUTH_ENDPOINTS } from './options.js';

const JWT_MAX_BYTES = 16 * 1024;
const MAX_KEYS = 16;
const CLOCK_SKEW_SECONDS = 60;
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const HEADER_FORBIDDEN = new Set(['crit', 'jku', 'x5u', 'jwk', 'x5c', 'x5t', 'x5t#S256']);

export type IdentityDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
};

function credential(): never {
  throw toolFault('credential', 'OAUTH_IDENTITY_INVALID');
}

export function verifyRs256(input: {
  signingInput: string; signature: Buffer; jwk: JsonWebKey;
}): boolean {
  try {
    const key = createPublicKey({ key: input.jwk, format: 'jwk' });
    return key.asymmetricKeyType === 'rsa'
      && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048
      && verify('RSA-SHA256', Buffer.from(input.signingInput, 'ascii'),
        { key, padding: constants.RSA_PKCS1_PADDING }, input.signature);
  } catch {
    return false;
  }
}

function decodeSegment(segment: string): Buffer {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) credential();
  const buffer = Buffer.from(segment, 'base64url');
  if (buffer.toString('base64url') !== segment) credential();
  return buffer;
}

function parseObject(raw: string): Record<string, unknown> {
  const scan = scanJsonObject(raw, { argumentBytes: JWT_MAX_BYTES, jsonDepth: 8 });
  if (scan.code !== null) credential();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    credential();
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) credential();
  return value as Record<string, unknown>;
}

function integerSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) credential();
  return value;
}

function equalHash(actual: string, expected: string): boolean {
  if (actual.length !== expected.length || actual.length !== 64) return false;
  try {
    return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function discoveryValid(json: unknown): boolean {
  if (!isRecord(json)) return false;
  const algs = json.id_token_signing_alg_values_supported;
  const methods = json.code_challenge_methods_supported;
  return (json.issuer === 'https://accounts.google.com' || json.issuer === 'accounts.google.com')
    && json.authorization_endpoint === GOOGLE_OAUTH_ENDPOINTS.authorization
    && json.token_endpoint === GOOGLE_OAUTH_ENDPOINTS.token
    && json.jwks_uri === GOOGLE_OAUTH_ENDPOINTS.jwks
    && Array.isArray(algs) && algs.includes('RS256')
    && Array.isArray(methods) && methods.includes('S256');
}

function privateMaterial(key: Record<string, unknown>): boolean {
  return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'priv', 'k'].some((field) => field in key);
}

function selectKey(jwks: unknown, kid: string): JsonWebKey {
  if (!isRecord(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length === 0 || jwks.keys.length > MAX_KEYS) {
    credential();
  }
  const matches: JsonWebKey[] = [];
  for (const key of jwks.keys) {
    if (!isRecord(key) || key.kid !== kid) continue;
    if (key.kty !== 'RSA' || privateMaterial(key)) credential();
    if (key.use !== undefined && key.use !== 'sig') credential();
    if (key.alg !== undefined && key.alg !== 'RS256') credential();
    if (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify'))) {
      credential();
    }
    matches.push(key as JsonWebKey);
  }
  if (matches.length !== 1) credential();
  return matches[0]!;
}

function audience(aud: unknown, clientId: string, azp: unknown): void {
  const values = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : credential();
  if (!values.every((entry) => typeof entry === 'string') || !values.includes(clientId)) credential();
  if (values.length > 1 && azp !== clientId) credential();
  if (azp !== undefined && azp !== clientId) credential();
}

function email(claims: Record<string, unknown>): string | null {
  if (claims.email_verified !== true) return null;
  if (typeof claims.email !== 'string' || claims.email.length > 320) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) ? claims.email : null;
}

export class GoogleCalendarIdentity implements GoogleIdentityPort {
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;

  constructor(dependencies: IdentityDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.clock = dependencies.now ?? Date.now;
  }

  async verify(input: {
    idToken: string; clientId: string; expectedNonceHash: string;
    now: string; signal: AbortSignal;
  }): Promise<{ subject: string; email: string | null }> {
    const deadlineAt = new Date(this.clock() + CALENDAR_LIMITS.toolTimeoutMs).toISOString();
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(CALENDAR_LIMITS.toolTimeoutMs)]);
    if (typeof input.idToken !== 'string' || Buffer.byteLength(input.idToken, 'utf8') > JWT_MAX_BYTES) {
      credential();
    }
    const parts = input.idToken.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) credential();
    const header = parseObject(decodeSegment(parts[0]!).toString('utf8'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length === 0
      || header.kid.length > 256 || [...HEADER_FORBIDDEN].some((field) => field in header)) {
      credential();
    }
    const claims = parseObject(decodeSegment(parts[1]!).toString('utf8'));
    const signature = decodeSegment(parts[2]!);
    const discovery = await oauthRequest({
      endpoint: 'discovery', method: 'GET', signal, deadlineAt,
      fetch: this.fetchImpl, now: this.clock,
    });
    if (discovery.status !== 200 || !discoveryValid(discovery.json)) credential();
    const jwks = await oauthRequest({
      endpoint: 'jwks', method: 'GET', signal, deadlineAt,
      fetch: this.fetchImpl, now: this.clock,
    });
    if (jwks.status !== 200) credential();
    const jwk = selectKey(jwks.json, header.kid);
    const signingInput = `${parts[0]}.${parts[1]}`;
    if (!verifyRs256({ signingInput, signature, jwk })) credential();
    const nowSeconds = Math.floor(Date.parse(input.now) / 1000);
    if (!Number.isFinite(nowSeconds)) credential();
    if (typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) credential();
    audience(claims.aud, input.clientId, claims.azp);
    const exp = integerSeconds(claims.exp);
    const iat = integerSeconds(claims.iat);
    if (!(exp > nowSeconds) || iat > nowSeconds + CLOCK_SKEW_SECONDS || !(iat < exp)) credential();
    if (claims.nbf !== undefined && integerSeconds(claims.nbf) > nowSeconds + CLOCK_SKEW_SECONDS) credential();
    if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) credential();
    if (typeof claims.nonce !== 'string') credential();
    const nonceHash = createHash('sha256').update(claims.nonce, 'utf8').digest('hex');
    if (!equalHash(nonceHash, input.expectedNonceHash)) credential();
    return { subject: claims.sub, email: email(claims) };
  }
}
