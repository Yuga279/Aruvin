/**
 * ============================================================================
 * FILE: auth-client.ts
 * LOCATION: frontend/src/api/auth-client.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bounded, credentials: 'same-origin' HTTP client for /auth/* endpoints.
 *
 * ROLE IN PROJECT:
 *    Communicates with backend authentication controllers using HttpOnly
 *    cookies without storing bearer tokens in browser memory or storage.
 *
 * KEY COMPONENTS:
 *    - createAuthClient: Factory creating me/login/logout/password/recovery methods.
 *    - AuthClientError: Safe error wrapper without raw credential leakage.
 * ============================================================================
 */

import {
  AUTH_ROUTES,
  isAuthErrorResponse,
  isAuthOkResponse,
  isAuthUserResponse,
  type AuthErrorCode,
  type AuthOkResponse,
  type AuthUser,
  type ForgotPasswordRequest,
  type LoginRequest,
  type PasswordRequest,
  type ResetPasswordRequest,
} from './auth-protocol.ts';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 65_536;
const SAFE_AUTH_MESSAGE = 'Authentication operation failed.';

export type AuthClientErrorCode =
  | AuthErrorCode
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'AUTH_REQUEST_TIMEOUT'
  | 'INVALID_AUTH_RESPONSE'
  | 'INVALID_AUTH_REQUEST';

export class AuthClientError extends Error {
  readonly code: AuthClientErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(options: {
    code: AuthClientErrorCode;
    status?: number;
    retryable?: boolean;
    message?: string;
  }) {
    super(options.message ?? SAFE_AUTH_MESSAGE);
    this.name = 'AuthClientError';
    this.code = options.code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
  }
}

export type AuthClient = {
  me(signal?: AbortSignal): Promise<AuthUser>;
  login(body: LoginRequest, signal?: AbortSignal): Promise<AuthUser>;
  logout(signal?: AbortSignal): Promise<void>;
  changePassword(body: PasswordRequest, signal?: AbortSignal): Promise<AuthUser>;
  forgotPassword(body: ForgotPasswordRequest, signal?: AbortSignal): Promise<AuthOkResponse>;
  resetPassword(body: ResetPasswordRequest, signal?: AbortSignal): Promise<AuthOkResponse>;
};

function readViteApiBase(): string | undefined {
  try {
    const env = import.meta.env as { VITE_API_BASE?: string } | undefined;
    return env?.VITE_API_BASE;
  } catch {
    return undefined;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const reader = response.body?.getReader();
  if (!reader) throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE', status: response.status });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE', status: response.status });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE', status: response.status });
  }
}

export function createAuthClient(options?: {
  baseUrl?: string;
  fetch?: typeof fetch;
}): AuthClient {
  const baseUrl = (options?.baseUrl ?? readViteApiBase() ?? '/api').replace(/\/+$/, '');
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

    try {
      const init: RequestInit = {
        method,
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        headers: body !== undefined
          ? { 'Content-Type': 'application/json', Accept: 'application/json' }
          : { Accept: 'application/json' },
        signal: combined,
      };
      if (body !== undefined) init.body = JSON.stringify(body);

      const response = await fetcher(`${baseUrl}${path}`, init);
      const payload = await readBoundedJson(response);

      if (!response.ok) {
        if (isAuthErrorResponse(payload)) {
          throw new AuthClientError({
            code: payload.error.code,
            status: response.status,
            retryable: payload.error.retryable,
          });
        }
        throw new AuthClientError({
          code: response.status === 401 ? 'UNAUTHENTICATED' : 'INVALID_AUTH_RESPONSE',
          status: response.status,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof AuthClientError) throw error;
      const aborted = combined.aborted;
      throw new AuthClientError({
        code: aborted ? (timeout.signal.aborted ? 'AUTH_REQUEST_TIMEOUT' : 'ABORTED') : 'NETWORK_ERROR',
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async me(signal) {
      const res = await request('GET', AUTH_ROUTES.me, undefined, signal);
      if (!isAuthUserResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res.user;
    },
    async login(body, signal) {
      const res = await request('POST', AUTH_ROUTES.login, body, signal);
      if (!isAuthUserResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res.user;
    },
    async logout(signal) {
      await request('POST', AUTH_ROUTES.logout, {}, signal);
    },
    async changePassword(body, signal) {
      const res = await request('POST', AUTH_ROUTES.password, body, signal);
      if (!isAuthUserResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res.user;
    },
    async forgotPassword(body, signal) {
      const res = await request('POST', AUTH_ROUTES.forgotPassword, body, signal);
      if (!isAuthOkResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res;
    },
    async resetPassword(body, signal) {
      const res = await request('POST', AUTH_ROUTES.resetPassword, body, signal);
      if (!isAuthOkResponse(res)) {
        throw new AuthClientError({ code: 'INVALID_AUTH_RESPONSE' });
      }
      return res;
    },
  };
}
