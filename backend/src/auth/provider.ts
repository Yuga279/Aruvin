/**
 * ============================================================================
 * FILE: provider.ts
 * LOCATION: backend/src/auth/provider.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Wrap official WorkOS user-management APIs behind a narrow auth port.
 *
 * ROLE IN PROJECT:
 *    Owns credentials and sealed sessions so P1/P2 never handle raw tokens,
 *    password hashes, or provider error payloads.
 *
 * KEY COMPONENTS:
 *    - AuthProvider / WorkosProvider: Bounded SDK adapter.
 *    - ProviderAccountConflict: Duplicate-creation distinction for P2.
 * ============================================================================
 */

import { WorkOS } from '@workos-inc/node';
import { idSchema } from '../contracts/identifiers.js';
import { boundedResult } from '../operations/bounded.js';
import type { WorkosBootstrap } from '../platform/config/bootstrap-config.js';
import { AuthFault } from './errors.js';

export type ProviderSession = { workosUserId: string; sessionId: string; sealedSession?: string };
export type ProviderUser = { id: string; email: string; externalId: string | null };
export interface AuthProvider {
  login(email: string, password: string): Promise<ProviderSession & { sealedSession: string }>;
  read(sealedSession: string): Promise<ProviderSession>;
  revoke(sessionId: string): Promise<void>;
  replacePassword(workosUserId: string, password: string): Promise<void>;
  sendRecovery(email: string): Promise<void>;
  reset(token: string, newPassword: string): Promise<{ workosUserId: string }>;
  createUser(input: { email: string; password: string; externalId: string }): Promise<ProviderUser>;
  getUser(workosUserId: string): Promise<ProviderUser>;
  listSessions(workosUserId: string, after?: string): Promise<{ ids: string[]; nextCursor: string | null }>;
}

export class ProviderAccountConflict extends Error { constructor() { super('ACCOUNT_CONFLICT'); } }

function safeProviderFault(error: unknown): AuthFault {
  if (error instanceof AuthFault) return error;
  const e = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof e.code === 'string' ? e.code : typeof e.error === 'string' ? e.error : '';
  if (e.status === 429 || e.statusCode === 429) return new AuthFault('RATE_LIMITED');
  if (e.status === 408 || e.statusCode === 408) return new AuthFault('AUTH_TIMEOUT');
  if (['invalid_credentials', 'invalid_grant', 'email_verification_required', 'mfa_challenge',
    'password_reset_token_expired', 'password_reset_token_invalid'].includes(code)) return new AuthFault('UNAUTHENTICATED');
  if (e.status === 400 || e.status === 409 || e.status === 422 || e.statusCode === 409) return new AuthFault('INVALID_REQUEST');
  return new AuthFault('AUTH_PROVIDER_UNAVAILABLE');
}

export function createWorkosProvider(config: WorkosBootstrap): WorkosProvider {
  const sdk = new WorkOS(config.apiKey, { clientId: config.clientId,
    issuer: `https://api.workos.com/user_management/${config.clientId}`, timeout: 10000, maxRetries: 0 });
  return new WorkosProvider(config, sdk.userManagement);
}
export class WorkosProvider implements AuthProvider {
  private active = 0;
  constructor(private readonly config: Pick<WorkosBootstrap, 'clientId' | 'cookiePassword'>,
    private readonly um: WorkOS['userManagement']) {}
  private async bounded<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= 4) throw new AuthFault('RATE_LIMITED');
    this.active++;
    const pending = Promise.resolve().then(job).then(value => ({ value }), error => ({ error }));
    // Keep the slot until actual settlement, including after a response timeout.
    void pending.finally(() => { this.active--; });
    const result = await boundedResult(pending, 10000);
    if (!result.ok) throw new AuthFault('AUTH_TIMEOUT');
    if ('error' in result.value) throw result.value.error instanceof ProviderAccountConflict
      ? result.value.error : safeProviderFault(result.value.error);
    return result.value.value;
  }
  async login(email: string, password: string): Promise<ProviderSession & { sealedSession: string }> {
    return this.bounded(async () => {
      const r = await this.um.authenticateWithPassword({ clientId: this.config.clientId, email, password,
        session: { sealSession: true, cookiePassword: this.config.cookiePassword } });
      if (!r.sealedSession) throw new AuthFault('AUTH_PROVIDER_UNAVAILABLE');
      const auth = await this.um.loadSealedSession({ sessionData: r.sealedSession, cookiePassword: this.config.cookiePassword }).authenticate();
      if (!auth.authenticated || auth.user.id !== r.user.id) throw new AuthFault('UNAUTHENTICATED');
      return { workosUserId: idSchema.parse(auth.user.id), sessionId: idSchema.parse(auth.sessionId), sealedSession: r.sealedSession };
    });
  }
  read(sealedSession: string): Promise<ProviderSession> {
    return this.bounded(async () => {
      const session = this.um.loadSealedSession({ sessionData: sealedSession, cookiePassword: this.config.cookiePassword });
      const result = await session.authenticate();
      if (result.authenticated) return { workosUserId: idSchema.parse(result.user.id), sessionId: idSchema.parse(result.sessionId) };
      if (result.reason !== 'invalid_jwt') throw new AuthFault('UNAUTHENTICATED');
      const refreshed = await session.refresh();
      if (!refreshed.authenticated) throw new AuthFault(refreshed.retryable ? 'AUTH_PROVIDER_UNAVAILABLE' : 'UNAUTHENTICATED');
      if (!refreshed.sealedSession) throw new AuthFault('AUTH_PROVIDER_UNAVAILABLE');
      const verified = await this.um.loadSealedSession({ sessionData: refreshed.sealedSession, cookiePassword: this.config.cookiePassword }).authenticate();
      if (!verified.authenticated) throw new AuthFault('UNAUTHENTICATED');
      return { workosUserId: idSchema.parse(verified.user.id), sessionId: idSchema.parse(verified.sessionId), sealedSession: refreshed.sealedSession };
    });
  }
  revoke(sessionId: string) { return this.bounded(() => this.um.revokeSession({ sessionId })); }
  replacePassword(userId: string, password: string) {
    return this.bounded(async () => { const user = await this.um.updateUser({ userId, password });
      if (user.id !== userId) throw new AuthFault('AUTH_PROVIDER_UNAVAILABLE'); });
  }
  sendRecovery(email: string) {
    return this.bounded(async () => { await this.um.createPasswordReset({ email }); });
  }
  reset(token: string, newPassword: string) {
    return this.bounded(async () => { const { user } = await this.um.resetPassword({ token, newPassword });
      return { workosUserId: idSchema.parse(user.id) }; });
  }
  createUser(input: { email: string; password: string; externalId: string }) {
    return this.bounded(async () => {
      try {
        const u = await this.um.createUser({ ...input, emailVerified: true });
        return { id: u.id, email: u.email, externalId: u.externalId ?? null };
      } catch (error) {
        const e = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {};
        if (e.status === 409 || ['email_exists', 'external_id_already_exists', 'user_already_exists'].includes(String(e.code)))
          throw new ProviderAccountConflict();
        throw error;
      }
    });
  }
  getUser(userId: string) {
    return this.bounded(async () => { const u = await this.um.getUser(userId);
      return { id: u.id, email: u.email, externalId: u.externalId ?? null }; });
  }
  listSessions(userId: string, after?: string) {
    return this.bounded(async () => { const page = await this.um.listSessions(userId, { limit: 100, ...(after ? { after } : {}) });
      return { ids: page.data.map(s => idSchema.parse(s.id)), nextCursor: page.listMetadata.after ?? null }; });
  }
}
