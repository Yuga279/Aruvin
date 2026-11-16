import { createHash, randomBytes } from 'node:crypto';
import {
  oauthStateSchema,
  type CalendarConnectionStore,
  type CalendarOAuthState,
  type GoogleIdentityPort,
} from '../../contracts/calendar-connections.js';
import { CALENDAR_LIMITS } from '../../contracts/calendar-policy.js';
import { AppError } from '../../platform/errors/app-error.js';
import { CalendarSecretCipher } from '../../platform/crypto/calendar-secret-cipher.js';
import {
  authorizationUrl,
  GoogleCalendarOAuthClient,
  OAuthScopeRejected,
  type OAuthGrant,
} from './oauth-client.js';
import {
  GoogleCalendarConnections,
  type SetupSnapshot,
} from './connection.js';
import { type CalendarSetupOptions } from './options.js';
import { CalendarToolFault } from './tools-validation.js';

export const OAUTH_COOKIE_NAME = 'aurvin_gcal_oauth';
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const QUERY_MAX = 8192;
const ALLOWED_QUERY = new Set([
  'state', 'code', 'error', 'error_description', 'error_uri',
  'scope', 'authuser', 'prompt', 'hd', 'iss',
]);
const GOOGLE_ISS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export type OAuthDependencies = {
  connections: GoogleCalendarConnections; store: CalendarConnectionStore;
  cipher: CalendarSecretCipher; options: CalendarSetupOptions;
  client: GoogleCalendarOAuthClient; googleIdentity: GoogleIdentityPort;
  now?: () => number;
};

export type PendingSetup = {
  stateHash: string;
  expiresAt: number;
  snapshot: SetupSnapshot;
  authSessionId: string;
};

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const randomOpaque = (): string => randomBytes(32).toString('base64url');

function invalid(): never {
  throw new AppError('INVALID_REQUEST', 'The request is invalid.', false);
}

function notReady(): never {
  throw new AppError('NOT_READY', 'Calendar setup is required.', false);
}

export function createOAuthState(input: {
  userId: string; redirectUri: string; now: number; cipher: CalendarSecretCipher;
}): { record: CalendarOAuthState; state: string; browser: string; nonce: string; challenge: string } {
  const state = randomOpaque(), browser = randomOpaque(), nonce = randomOpaque();
  const verifier = randomOpaque();
  const binding = { userId: input.userId, stateHash: hash(state), browserHash: hash(browser),
    oidcNonceHash: hash(nonce), redirectUri: input.redirectUri };
  return {
    record: oauthStateSchema.parse({ ...binding, schemaVersion: 1, kind: 'calendar-oauth-state',
      encryptedVerifier: input.cipher.sealVerifier(binding, verifier),
      createdAt: new Date(input.now).toISOString(),
      expiresAt: new Date(input.now + CALENDAR_LIMITS.oauthStateMs).toISOString(), consumedAt: null }),
    state, browser, nonce,
    challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'),
  };
}

export function oauthCookie(browser: string): string {
  return `${OAUTH_COOKIE_NAME}=${browser}; Path=/api/plugins/google-calendar/oauth; HttpOnly; SameSite=Lax; Max-Age=600`;
}

export function clearOAuthCookie(): string {
  return `${OAUTH_COOKIE_NAME}=; Path=/api/plugins/google-calendar/oauth; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function uniqueQuery(rawQuery: string): URLSearchParams {
  if (Buffer.byteLength(rawQuery, 'utf8') > QUERY_MAX) invalid();
  const pairs = rawQuery.length === 0 ? [] : rawQuery.split('&');
  const keys: string[] = [];
  for (const pair of pairs) {
    const key = decodeURIComponent((pair.split('=')[0] ?? '').replace(/\+/g, ' '));
    if (!ALLOWED_QUERY.has(key)) invalid();
    keys.push(key);
  }
  if (new Set(keys).size !== keys.length) invalid();
  return new URLSearchParams(rawQuery);
}

function cookieValue(cookieHeader: string | undefined): string {
  if (cookieHeader === undefined || cookieHeader.length === 0) invalid();
  const parts = cookieHeader.split(';').map((part) => part.trim());
  const matched: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === OAUTH_COOKIE_NAME) matched.push(part.slice(eq + 1));
  }
  if (matched.length !== 1) invalid();
  const value = matched[0]!;
  if (!OPAQUE.test(value)) invalid();
  return value;
}

export class GoogleCalendarOAuthService {
  private readonly connections: GoogleCalendarConnections;
  private readonly store: CalendarConnectionStore;
  private readonly cipher: CalendarSecretCipher;
  private readonly options: CalendarSetupOptions;
  private readonly client: Pick<GoogleCalendarOAuthClient, 'exchange'>;
  private readonly googleIdentity: GoogleIdentityPort;
  private readonly clock: () => number;
  // ponytail: single-flow/single-process pending setup snapshot; a restart
  // loses this entry even if a durable OAuth-state record remains. Upgrade
  // to a durable versioned setup-snapshot when multi-process setup exists.
  private pending: PendingSetup | null = null;
  private flowHash: string | null = null;

  constructor(dependencies: OAuthDependencies) {
    this.connections = dependencies.connections;
    this.store = dependencies.store;
    this.cipher = dependencies.cipher;
    this.options = dependencies.options;
    this.client = dependencies.client;
    this.googleIdentity = dependencies.googleIdentity;
    this.clock = dependencies.now ?? Date.now;
  }

  get frontendOrigin(): string {
    return this.options.frontendOrigin;
  }

  cancelPending(authSessionId?: string): void {
    if (authSessionId !== undefined && this.pending?.authSessionId !== authSessionId) return;
    this.pending = null; this.flowHash = null;
    this.connections.invalidateLifecycle();
  }
  async start(signal: AbortSignal, authSessionId: string): Promise<{ authorizationUrl: string; browserCookie: string }> {
    if (signal.aborted) throw new AppError('CANCELLED', 'Calendar setup was cancelled.', false);
    if (this.options.oauth === null) notReady();
    await this.connections.beginConsent(signal);
    const snapshot = await this.connections.captureSetupSnapshot();
    const created = createOAuthState({
      userId: this.connections.userId,
      redirectUri: this.options.oauth.redirectUri,
      now: this.clock(),
      cipher: this.cipher,
    });
    await this.store.putState(created.record);
    this.pending = {
      stateHash: created.record.stateHash,
      expiresAt: Date.parse(created.record.expiresAt),
      snapshot,
      authSessionId,
    };
    this.flowHash = created.record.stateHash;
    return {
      authorizationUrl: authorizationUrl(this.options, {
        state: created.state, nonce: created.nonce, challenge: created.challenge,
      }),
      browserCookie: created.browser,
    };
  }

  async callback(input: { rawQuery: string; cookieHeader?: string }, signal: AbortSignal, authSessionId: string): Promise<
    'connected' | 'fixture' | 'cancelled' | 'failed'
  > {
    if (signal.aborted) throw new AppError('CANCELLED', 'Calendar setup was cancelled.', false);
    const params = uniqueQuery(input.rawQuery);
    const state = params.get('state') ?? '';
    const code = params.get('code');
    const error = params.get('error');
    const iss = params.get('iss');
    if (!OPAQUE.test(state)) invalid();
    if (iss !== null && !GOOGLE_ISS.has(iss)) invalid();
    if ((code === null) === (error === null)) invalid();
    if (code !== null && (code.length === 0 || code.length > 512)) invalid();
    const browser = cookieValue(input.cookieHeader);
    const now = this.clock();
    const pending = this.pending;
    const stateHash = hash(state);
    const browserHash = hash(browser);
    if (!pending || pending.stateHash !== stateHash || now >= pending.expiresAt
      || pending.authSessionId !== authSessionId
      || !this.connections.isCurrentSnapshot(pending.snapshot)) {
      invalid();
    }
    if (pending.snapshot.redirectUri !== this.options.oauth?.redirectUri) invalid();
    let consumed: CalendarOAuthState | null;
    try {
      consumed = await this.store.consumeState({
        userId: this.connections.userId,
        stateHash,
        browserHash,
        now: new Date(now).toISOString(),
      });
    } catch {
      throw new AppError('PERSISTENCE_ERROR', 'The save could not be confirmed.', false);
    }
    if (consumed === null) invalid();
    if (consumed.redirectUri !== this.options.oauth?.redirectUri
      || consumed.stateHash !== stateHash || consumed.browserHash !== browserHash
      || Date.parse(consumed.expiresAt) <= now) {
      invalid();
    }
    const snapshot = pending.snapshot;
    const flowHash = pending.stateHash;
    if (this.pending?.stateHash === stateHash) this.pending = null;
    if (error !== null) return error === 'access_denied' ? 'cancelled' : 'failed';
    let verifier: string;
    try {
      verifier = this.cipher.openVerifier({
        userId: consumed.userId,
        stateHash: consumed.stateHash,
        browserHash: consumed.browserHash,
        oidcNonceHash: consumed.oidcNonceHash,
        redirectUri: consumed.redirectUri,
      }, consumed.encryptedVerifier);
    } catch {
      throw new AppError('NOT_READY', 'Calendar credentials are unavailable.', false);
    }
    const deadlineAt = new Date(now + CALENDAR_LIMITS.toolTimeoutMs).toISOString();
    const bound = AbortSignal.any([signal, AbortSignal.timeout(CALENDAR_LIMITS.toolTimeoutMs)]);
    let grant: OAuthGrant;
    try {
      grant = await this.client.exchange({
        code: code!,
        verifier,
        signal: bound,
        deadlineAt,
      });
    } catch (error) {
      if (error instanceof OAuthScopeRejected) {
        this.connections.recordPartialGrantDiagnostic(snapshot.lifecycleEpoch, error.missingScopes);
        if (this.flowHash === flowHash) this.flowHash = null;
        return 'failed';
      }
      throw error;
    }
    if (this.options.oauth === null) notReady();
    const account = await this.googleIdentity.verify({
      idToken: grant.idToken,
      clientId: this.options.oauth.clientId,
      expectedNonceHash: consumed.oidcNonceHash,
      now: new Date(now).toISOString(),
      signal: bound,
    });
    try {
      await this.connections.installGrant({
        snapshot,
        grant,
        account,
        signal: bound,
        deadlineAt,
        isCurrentFlow: () => this.flowHash === flowHash && this.connections.isCurrentSnapshot(snapshot),
      });
    } catch (error) {
      if (error instanceof CalendarToolFault && error.failure.code === 'OAUTH_SUBJECT_CHANGED') {
        if (this.flowHash === flowHash) this.flowHash = null;
        return 'failed';
      }
      throw error;
    }
    this.connections.clearPartialGrantDiagnostic();
    if (this.flowHash === flowHash) this.flowHash = null;
    return this.options.evidence === 'fixture' ? 'fixture' : 'connected';
  }
}
