/**
 * ============================================================================
 * FILE: auth.service.ts
 * LOCATION: backend/src/auth/auth.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Implement closed login, admission, logout, password, and recovery flows.
 *
 * ROLE IN PROJECT:
 *    Owns application session binding and onboarding gates while WorkOS owns
 *    credentials. Independently testable before P3 root wiring.
 *
 * KEY COMPONENTS:
 *    - login / authenticate / logout / me: Closed session admission.
 *    - password / forgotPassword / resetPassword: Onboarding and recovery.
 * ============================================================================
 */

import type { ZodType, ZodTypeDef } from 'zod';
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  passwordRequestSchema,
  resetPasswordRequestSchema,
  type AccountRead,
  type AuthOkResponse,
  type AuthPrincipal,
  type AuthUser,
  type AuthUserResponse,
  type UserAccount,
  type UsersRepository,
} from '../contracts/auth.js';
import { admitAccount, invalidateAccount, publicUser } from './access.js';
import { AttemptLimiter } from './attempt-limiter.js';
import { AuthFault } from './errors.js';
import type { AuthProvider } from './provider.js';

function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new AuthFault('INVALID_REQUEST');
  return result.data;
}

export type AuthServiceOptions = { users: UsersRepository; provider: AuthProvider | null; now?: () => Date };
export class AuthService {
  private readonly limiter = new AttemptLimiter();
  constructor(private readonly o: AuthServiceOptions) {}
  private now() { return (this.o.now ?? (() => new Date()))().toISOString(); }
  private provider(): AuthProvider { if (!this.o.provider) throw new AuthFault('NOT_READY'); return this.o.provider; }
  private async confirmed(expected: AccountRead, next: UserAccount): Promise<AccountRead> {
    const r = await this.o.users.compareAndSwap(expected, next);
    if (r.outcome !== 'confirmed') throw new AuthFault('NOT_READY'); return r.value;
  }
  async login(body: unknown): Promise<{ user: AuthUser; sealedSession: string }> {
    this.limiter.takeGlobal();
    const request = parse(loginRequestSchema, body); this.limiter.take('login', request.email);
    const provider = this.provider();
    // Snapshot before inference-like external work; a concurrent deactivate/reset must win the CAS.
    const local = await this.o.users.byEmail(request.email);
    const session = await provider.login(request.email, request.password);
    if (!local || local.account.status !== 'active' || local.account.workosUserId !== session.workosUserId) {
      await provider.revoke(session.sessionId).catch(() => undefined); throw new AuthFault('UNAUTHENTICATED');
    }
    // ponytail: one live WorkOS session per account; use a bounded session store if concurrent devices become required.
    let saved: AccountRead;
    try { saved = await this.confirmed(local, { ...local.account, currentWorkosSessionId: session.sessionId, updatedAt: this.now() }); }
    catch (error) { await provider.revoke(session.sessionId).catch(() => undefined); throw error; }
    return { user: publicUser(saved.account), sealedSession: session.sealedSession };
  }
  async authenticate(cookie: string | null): Promise<{ principal: AuthPrincipal; sealedSession?: string }> {
    const provider = this.provider(); if (!cookie) throw new AuthFault('UNAUTHENTICATED');
    const session = await provider.read(cookie);
    const local = await this.o.users.bySubject(session.workosUserId);
    const principal = admitAccount(local?.account ?? null, session.sessionId);
    return { principal, ...(session.sealedSession ? { sealedSession: session.sealedSession } : {}) };
  }
  async logout(principal: AuthPrincipal): Promise<void> {
    const provider = this.provider(); const current = await this.o.users.get(principal.account.userId);
    if (current && current.account.currentWorkosSessionId === principal.sessionId)
      await this.confirmed(current, invalidateAccount(current.account, this.now()));
    await provider.revoke(principal.sessionId);
  }
  me(principal: AuthPrincipal): AuthUserResponse { return { user: publicUser(principal.account) }; }
  async password(principal: AuthPrincipal, body: unknown): Promise<{ user: AuthUser; sealedSession: string }> {
    this.limiter.takeGlobal(); const request = parse(passwordRequestSchema, body); const provider = this.provider();
    const current = await this.o.users.get(principal.account.userId);
    if (!current) throw new AuthFault('UNAUTHENTICATED'); admitAccount(current.account, principal.sessionId);
    this.limiter.take('login', current.account.emailNormalized);
    const proof = await provider.login(current.account.emailNormalized, request.currentPassword);
    try {
      if (proof.workosUserId !== current.account.workosUserId) throw new AuthFault('UNAUTHENTICATED');
    } finally { await provider.revoke(proof.sessionId); }
    // Remove old application access before dispatching a credential mutation. A timeout cannot unlock it.
    const fenced = await this.confirmed(current, invalidateAccount(current.account, this.now()));
    try {
      await provider.replacePassword(current.account.workosUserId, request.newPassword);
    } catch (error) {
      if (error instanceof AuthFault && error.code === 'INVALID_REQUEST') {
        await this.confirmed(fenced, { ...current.account, sessionEpoch: fenced.account.sessionEpoch, updatedAt: this.now() }).catch(() => undefined);
      }
      throw error;
    }
    const fresh = await provider.login(current.account.emailNormalized, request.newPassword);
    if (fresh.workosUserId !== current.account.workosUserId) {
      await provider.revoke(fresh.sessionId).catch(() => undefined); throw new AuthFault('UNAUTHENTICATED');
    }
    let saved: AccountRead;
    try { saved = await this.confirmed(fenced, { ...fenced.account, passwordChangeRequired: false,
      currentWorkosSessionId: fresh.sessionId, updatedAt: this.now() }); }
    catch (error) { await provider.revoke(fresh.sessionId).catch(() => undefined); throw error; }
    await provider.revoke(principal.sessionId).catch(() => undefined);
    return { user: publicUser(saved.account), sealedSession: fresh.sealedSession };
  }
  async forgotPassword(body: unknown): Promise<AuthOkResponse> {
    this.limiter.takeGlobal(); const { email } = parse(forgotPasswordRequestSchema, body);
    this.limiter.take('recovery', email);
    // Uniform even if configured provider/storage is unavailable; no account-existence signal.
    try {
      const provider = this.provider(); const local = await this.o.users.byEmail(email);
      if (local?.account.status === 'active') await provider.sendRecovery(local.account.emailNormalized);
    } catch { /* No token/error payload is logged or reflected. Same response as unknown email. */ }
    return { ok: true };
  }
  async resetPassword(body: unknown): Promise<AuthOkResponse> {
    this.limiter.takeGlobal(); const { token, newPassword } = parse(resetPasswordRequestSchema, body);
    const result = await this.provider().reset(token, newPassword);
    // Provider identifies the subject. Do not infer an owner from email or a client id.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.o.users.bySubject(result.workosUserId);
      if (!current) throw new AuthFault('UNAUTHENTICATED');
      const next = { ...invalidateAccount(current.account, this.now()), passwordChangeRequired: false };
      const saved = await this.o.users.compareAndSwap(current, next);
      if (saved.outcome === 'confirmed') return { ok: true };
      if (saved.outcome === 'uncertain') throw new AuthFault('NOT_READY');
    }
    throw new AuthFault('NOT_READY');
  }
}
