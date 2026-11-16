/**
 * ============================================================================
 * FILE: administration-client.ts
 * LOCATION: frontend/src/api/administration-client.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bounded, credentials: 'same-origin' HTTP client for /admin/users/* endpoints.
 *
 * ROLE IN PROJECT:
 *    Enables the Super Admin user management panel to query keyset pages,
 *    provision new User accounts, and run lifecycle actions without secrets.
 *
 * KEY COMPONENTS:
 *    - createAdministrationClient: Factory for user table & lifecycle actions.
 *    - AdministrationClientError: Closed error mapping with safe presentations.
 * ============================================================================
 */

import {
  ADMINISTRATION_ROUTES,
  isAdministrationErrorResponse,
  isAdministrationPage,
  isAdministrationUserResponse,
  type AdministrationErrorCode,
  type AdministrationPage,
  type AdministrationUser,
  type CreateUserRequest,
} from './administration-protocol.ts';
import { isAuthOkResponse, type AuthOkResponse } from './auth-protocol.ts';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 65_536;
const SAFE_ADMIN_MESSAGE = 'Administration request could not be completed.';

export type AdministrationClientErrorCode =
  | AdministrationErrorCode
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'ADMIN_REQUEST_TIMEOUT'
  | 'INVALID_ADMIN_RESPONSE'
  | 'INVALID_ADMIN_REQUEST';

export class AdministrationClientError extends Error {
  readonly code: AdministrationClientErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(options: {
    code: AdministrationClientErrorCode;
    status?: number;
    retryable?: boolean;
    message?: string;
  }) {
    super(options.message ?? SAFE_ADMIN_MESSAGE);
    this.name = 'AdministrationClientError';
    this.code = options.code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
  }
}

export type AdministrationClient = {
  listUsers(query?: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<AdministrationPage>;
  createUser(body: CreateUserRequest, signal?: AbortSignal): Promise<AdministrationUser>;
  deactivateUser(userId: string, signal?: AbortSignal): Promise<AdministrationUser>;
  reactivateUser(userId: string, signal?: AbortSignal): Promise<AdministrationUser>;
  sendPasswordReset(userId: string, signal?: AbortSignal): Promise<AuthOkResponse>;
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
  const reader = response.body?.getReader();
  if (!reader) throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE', status: response.status });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE', status: response.status });
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
    throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE', status: response.status });
  }
}

export function createAdministrationClient(options?: {
  baseUrl?: string;
  fetch?: typeof fetch;
}): AdministrationClient {
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
        if (isAdministrationErrorResponse(payload)) {
          throw new AdministrationClientError({
            code: payload.error.code,
            status: response.status,
            retryable: payload.error.retryable,
          });
        }
        throw new AdministrationClientError({
          code: 'INVALID_ADMIN_RESPONSE',
          status: response.status,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof AdministrationClientError) throw error;
      const aborted = combined.aborted;
      throw new AdministrationClientError({
        code: aborted ? (timeout.signal.aborted ? 'ADMIN_REQUEST_TIMEOUT' : 'ABORTED') : 'NETWORK_ERROR',
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async listUsers(query, signal) {
      const params = new URLSearchParams();
      if (query?.limit !== undefined) params.set('limit', String(query.limit));
      if (query?.cursor) params.set('cursor', query.cursor);
      const qs = params.toString();
      const path = qs ? `${ADMINISTRATION_ROUTES.users}?${qs}` : ADMINISTRATION_ROUTES.users;
      const res = await request('GET', path, undefined, signal);
      if (!isAdministrationPage(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res;
    },
    async createUser(body, signal) {
      const res = await request('POST', ADMINISTRATION_ROUTES.users, body, signal);
      if (!isAdministrationUserResponse(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res.user;
    },
    async deactivateUser(userId, signal) {
      const res = await request('POST', ADMINISTRATION_ROUTES.deactivate(userId), {}, signal);
      if (!isAdministrationUserResponse(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res.user;
    },
    async reactivateUser(userId, signal) {
      const res = await request('POST', ADMINISTRATION_ROUTES.reactivate(userId), {}, signal);
      if (!isAdministrationUserResponse(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res.user;
    },
    async sendPasswordReset(userId, signal) {
      const res = await request('POST', ADMINISTRATION_ROUTES.passwordReset(userId), {}, signal);
      if (!isAuthOkResponse(res)) {
        throw new AdministrationClientError({ code: 'INVALID_ADMIN_RESPONSE' });
      }
      return res;
    },
  };
}
