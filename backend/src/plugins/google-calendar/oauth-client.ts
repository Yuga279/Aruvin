/**
 * ============================================================================
 * FILE: oauth-client.ts
 * LOCATION: backend/src/plugins/google-calendar/oauth-client.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Execute OAuth authorization, token exchange, refresh, and revocation with Google.
 *
 * ROLE IN PROJECT:
 *    Provides low-level OAuth HTTP client interactions with Google token and revocation
 *    endpoints, enforcing PKCE, S256, incremental consent, and exact granted scope verification.
 *
 * KEY COMPONENTS:
 *    - authorizationUrl: Builds Google OAuth authorization URL with S256 PKCE and incremental consent
 *    - OAuthScopeRejected: Fault reporting missing required scopes without leaking tokens
 *    - GoogleCalendarOAuthClient: Exchange, refresh, and revoke operations with bounded readers
 * ============================================================================
 */

import {
  CALENDAR_SCOPES,
  calendarFailureSchema,
  calendarGrantSchema,
  calendarGrantStatus,
  type CalendarFailure,
} from '../../contracts/calendar-policy.js';
import { calendarOAuthStartResponseSchema } from '../../contracts/calendar-wire.js';
import { AppError } from '../../platform/errors/app-error.js';
import { CalendarToolFault, toolFault } from './tools-validation.js';
import { oauthRequest } from './oauth-http.js';
import { GOOGLE_OAUTH_ENDPOINTS, type CalendarSetupOptions } from './options.js';

export type OAuthGrant = {
  accessToken: string; refreshToken: string; idToken: string;
  expiresAt: string; scopes: string[];
};
export type RefreshedGrant = {
  accessToken: string; refreshToken: string | null;
  expiresAt: string; scopes: string[] | null;
};
export type OAuthDeadline = { signal: AbortSignal; deadlineAt: string };

const CONTROL = /[\u0000-\u001F\u007F]/;
const EMAIL_ALIAS = 'https://www.googleapis.com/auth/userinfo.email';
const TOKEN_MAX_BYTES = 8192;

export class OAuthScopeRejected extends CalendarToolFault {
  readonly missingScopes: readonly string[];
  constructor(scopes: readonly string[]) {
    super(calendarFailureSchema.parse({ category: 'credential', code: 'OAUTH_SCOPE_REJECTED', retry: 'none' }));
    this.missingScopes = Object.freeze(CALENDAR_SCOPES.filter((s) => !scopes.includes(s)));
  }
}

const PROVIDER_FAULTS: Record<string, CalendarFailure> = {
  invalid_grant: calendarFailureSchema.parse({
    category: 'credential', code: 'RECONNECT_REQUIRED', retry: 'none',
  }),
  invalid_client: calendarFailureSchema.parse({
    category: 'credential', code: 'OAUTH_CLIENT_REJECTED', retry: 'none',
  }),
  invalid_request: calendarFailureSchema.parse({
    category: 'credential', code: 'OAUTH_REQUEST_REJECTED', retry: 'none',
  }),
  invalid_scope: calendarFailureSchema.parse({
    category: 'credential', code: 'OAUTH_SCOPE_REJECTED', retry: 'none',
  }),
  unauthorized_client: calendarFailureSchema.parse({
    category: 'credential', code: 'OAUTH_CLIENT_REJECTED', retry: 'none',
  }),
  unsupported_grant_type: calendarFailureSchema.parse({
    category: 'credential', code: 'OAUTH_REQUEST_REJECTED', retry: 'none',
  }),
};

export type OAuthClientDependencies = {
  options: CalendarSetupOptions;
  fetch?: typeof fetch;
  now?: () => number;
};

function requireOauth(options: CalendarSetupOptions): NonNullable<CalendarSetupOptions['oauth']> {
  if (options.oauth === null) {
    throw new AppError('NOT_READY', 'Calendar setup is required.', false);
  }
  return options.oauth;
}

export function authorizationUrl(options: CalendarSetupOptions, input: {
  state: string; nonce: string; challenge: string;
}): string {
  const oauth = requireOauth(options);
  const url = new URL(GOOGLE_OAUTH_ENDPOINTS.authorization);
  url.search = new URLSearchParams({
    client_id: oauth.clientId, redirect_uri: oauth.redirectUri,
    response_type: 'code', scope: CALENDAR_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    state: input.state, nonce: input.nonce,
    code_challenge: input.challenge, code_challenge_method: 'S256',
  }).toString();
  return calendarOAuthStartResponseSchema.parse({ authorizationUrl: url.href }).authorizationUrl;
}

function assertToken(value: unknown): string {
  if (typeof value !== 'string') throw toolFault('credential', 'OAUTH_TOKEN_INVALID');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < 1 || bytes > TOKEN_MAX_BYTES || value.trim() !== value || CONTROL.test(value)) {
    throw toolFault('credential', 'OAUTH_TOKEN_INVALID');
  }
  return value;
}

function canonicalizeScopes(scope: unknown): string[] {
  if (typeof scope !== 'string') throw new OAuthScopeRejected([]);
  const rawScopes = scope.split(/\s+/).filter(Boolean).map((s) => s === EMAIL_ALIAS ? 'email' : s);
  const deduplicated = [...new Set(rawScopes)];
  const parseResult = calendarGrantSchema.safeParse(deduplicated);
  if (!parseResult.success) {
    throw new OAuthScopeRejected(deduplicated);
  }
  return parseResult.data;
}

function requireScopes(scopes: string[]): string[] {
  if (calendarGrantStatus(scopes).state !== 'complete') throw new OAuthScopeRejected(scopes);
  return scopes;
}

function expiry(expiresIn: unknown, now: number): string {
  if (typeof expiresIn !== 'number' || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
    throw toolFault('credential', 'OAUTH_TOKEN_INVALID');
  }
  const at = now + expiresIn * 1000;
  if (!Number.isFinite(at)) throw toolFault('credential', 'OAUTH_TOKEN_INVALID');
  const iso = new Date(at).toISOString();
  if (Number.isNaN(Date.parse(iso))) throw toolFault('credential', 'OAUTH_TOKEN_INVALID');
  return iso;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classifyProviderError(json: unknown): never {
  const error = isRecord(json) && typeof json.error === 'string' ? json.error : '';
  const failure = PROVIDER_FAULTS[error];
  if (failure) throw new CalendarToolFault(failure);
  throw toolFault('credential', 'OAUTH_PROVIDER_REJECTED');
}

function safeSecret(error: unknown): never {
  if (error instanceof AppError || error instanceof CalendarToolFault) throw error;
  throw new AppError('PROVIDER_ERROR', 'Calendar setup could not be completed.', false);
}

export class GoogleCalendarOAuthClient {
  private readonly options: CalendarSetupOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;

  constructor(dependencies: OAuthClientDependencies) {
    this.options = dependencies.options;
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.clock = dependencies.now ?? Date.now;
  }

  async exchange(input: {
    code: string; verifier: string; signal: AbortSignal; deadlineAt: string;
  }): Promise<OAuthGrant> {
    const oauth = requireOauth(this.options);
    try {
      const response = await oauthRequest({
        endpoint: 'token',
        method: 'POST',
        body: new URLSearchParams({
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          redirect_uri: oauth.redirectUri,
          code: input.code,
          grant_type: 'authorization_code',
          code_verifier: input.verifier,
        }),
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        fetch: this.fetchImpl,
        now: this.clock,
      });
      if (response.status !== 200 || !isRecord(response.json)) classifyProviderError(response.json);
      const json = response.json;
      if (json.token_type !== 'Bearer') throw toolFault('credential', 'OAUTH_TOKEN_INVALID');
      const scopes = requireScopes(canonicalizeScopes(json.scope));
      return {
        accessToken: assertToken(json.access_token),
        refreshToken: assertToken(json.refresh_token),
        idToken: assertToken(json.id_token),
        expiresAt: expiry(json.expires_in, this.clock()),
        scopes,
      };
    } catch (error) {
      safeSecret(error);
    }
  }

  async refresh(input: {
    refreshToken: string; signal: AbortSignal; deadlineAt: string;
  }): Promise<RefreshedGrant> {
    const oauth = requireOauth(this.options);
    try {
      const response = await oauthRequest({
        endpoint: 'token',
        method: 'POST',
        body: new URLSearchParams({
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          refresh_token: input.refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        fetch: this.fetchImpl,
        now: this.clock,
      });
      if (response.status !== 200 || !isRecord(response.json)) classifyProviderError(response.json);
      const json = response.json;
      if (json.token_type !== 'Bearer') throw toolFault('credential', 'OAUTH_TOKEN_INVALID');
      const scopes = json.scope === undefined ? null : requireScopes(canonicalizeScopes(json.scope));
      const refreshToken = json.refresh_token === undefined ? null : assertToken(json.refresh_token);
      return {
        accessToken: assertToken(json.access_token),
        refreshToken,
        expiresAt: expiry(json.expires_in, this.clock()),
        scopes,
      };
    } catch (error) {
      safeSecret(error);
    }
  }

  async revoke(input: {
    token: string; signal: AbortSignal; deadlineAt: string;
  }): Promise<'confirmed' | 'failed' | 'unknown'> {
    const oauth = this.options.oauth;
    if (oauth === null) return 'unknown';
    try {
      const response = await oauthRequest({
        endpoint: 'revoke',
        method: 'POST',
        body: new URLSearchParams({ token: input.token }),
        signal: input.signal,
        deadlineAt: input.deadlineAt,
        fetch: this.fetchImpl,
        now: this.clock,
      });
      if (response.status === 200) return 'confirmed';
      if (response.status >= 400 && response.status < 500) return 'failed';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
