/**
 * ============================================================================
 * FILE: administration.service.ts
 * LOCATION: backend/src/administration/administration.service.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Implement Super-Admin-only account administration without credential storage.
 *
 * ROLE IN PROJECT:
 *    Reuses admitted persistence and P1 auth/provider boundaries.
 *    Exposes a narrow deactivation callback for P3's existing runtime owner.
 *
 * KEY COMPONENTS:
 *    - Current-admin checks, safe rows and bounded lifecycle methods.
 * ============================================================================
 */
import { randomUUID } from 'node:crypto';
import { administrationActionRequestSchema, administrationPageQuerySchema,
  createUserRequestSchema, type AdministrationPage, type AdministrationUser,
  type AdministrationUserResponse } from '../contracts/administration.js';
import { normalizedEmailSchema, userAccountSchema, type AccountRead,
  type AuthPrincipal, type UserAccount, type UsersRepository } from '../contracts/auth.js';
import { idSchema } from '../contracts/identifiers.js';
import { admitAccount, invalidateAccount, publicUser, requireSuperAdmin } from '../auth/access.js';
import { AttemptLimiter } from '../auth/attempt-limiter.js';
import { AuthFault } from '../auth/errors.js';
import { ProviderAccountConflict, type AuthProvider, type ProviderUser } from '../auth/provider.js';
import { boundedResult } from '../operations/bounded.js';
import { AdministrationFault, safeAdministrationFault } from './errors.js';

export type AdministrationProvider = Pick<AuthProvider, 'createUser' | 'sendRecovery' | 'revoke' | 'listSessions'>;
export type AdministrationServiceOptions = {
  users: UsersRepository; provider: AdministrationProvider | null;
  now?: () => Date; newUserId?: () => string;
  onUserDeactivated?: (userId: string) => void | Promise<void>;
};
function row(account: Readonly<UserAccount>): AdministrationUser {
  return { ...publicUser(account), status: account.status, createdAt: account.createdAt };
}
export class AdministrationService {
  private readonly limiter: AttemptLimiter;
  constructor(private readonly o: AdministrationServiceOptions) {
    this.limiter = new AttemptLimiter(() => this.now().getTime());
  }
  private now(): Date { return (this.o.now ?? (() => new Date()))(); }
  private newUserId(): string { return (this.o.newUserId ?? randomUUID)(); }
  private provider(): AdministrationProvider {
    if (!this.o.provider) throw new AuthFault('NOT_READY'); return this.o.provider;
  }
  private async requireAdmin(principal: AuthPrincipal | null): Promise<AuthPrincipal> {
    if (!principal) throw new AuthFault('UNAUTHENTICATED');
    const current = await this.o.users.get(principal.account.userId);
    const admitted = requireSuperAdmin(admitAccount(current?.account ?? null, principal.sessionId));
    this.limiter.takeGlobal(); return admitted;
  }
  async list(principal: AuthPrincipal | null, query: unknown): Promise<AdministrationPage> {
    await this.requireAdmin(principal);
    const request = administrationPageQuerySchema.safeParse(query);
    if (!request.success) throw new AuthFault('INVALID_REQUEST');
    try {
      const page = await this.o.users.list({ ...request.data, limit: request.data.limit ?? 20 });
      return { items: page.items.map(value => row(value.account)), nextCursor: page.nextCursor };
    } catch (error) { throw safeAdministrationFault(error); }
  }
  async create(principal: AuthPrincipal | null, body: unknown): Promise<AdministrationUserResponse> {
    await this.requireAdmin(principal);
    const request = createUserRequestSchema.safeParse(body);
    if (!request.success) throw new AuthFault('INVALID_REQUEST');
    const provider = this.provider();
    if (await this.o.users.byEmail(request.data.email)) throw new AdministrationFault('ACCOUNT_CONFLICT');
    const userId = idSchema.parse(this.newUserId());
    let created: ProviderUser;
    try {
      created = await provider.createUser({ email: request.data.email,
        password: request.data.temporaryPassword, externalId: userId });
    } catch (error) {
      if (error instanceof ProviderAccountConflict) throw new AdministrationFault('ACCOUNT_CONFLICT');
      if (error instanceof AuthFault && ['INVALID_REQUEST', 'RATE_LIMITED'].includes(error.code)) throw error;
      // Unknown provider outcome may already have created credentials. Never retry or adopt by email.
      throw new AdministrationFault('ACCOUNT_PROVISIONING_INCOMPLETE');
    }
    if (!idSchema.safeParse(created.id).success || created.externalId !== userId ||
        normalizedEmailSchema.safeParse(created.email).data !== request.data.email)
      throw new AdministrationFault('ACCOUNT_PROVISIONING_INCOMPLETE');
    const at = this.now().toISOString();
    try {
      const saved = await this.o.users.insert(userAccountSchema.parse({ schemaVersion: 1,
        userId, workosUserId: created.id, emailNormalized: request.data.email, role: 'user',
        status: 'active', passwordChangeRequired: true, currentWorkosSessionId: null,
        sessionEpoch: 0, createdAt: at, updatedAt: at }));
      return { user: row(saved.account) };
    } catch { throw new AdministrationFault('ACCOUNT_PROVISIONING_INCOMPLETE'); }
  }
  private async target(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<AccountRead> {
    const actor = await this.requireAdmin(principal);
    if (!idSchema.safeParse(userId).success || !administrationActionRequestSchema.safeParse(body).success)
      throw new AuthFault('INVALID_REQUEST');
    const current = await this.o.users.get(userId);
    if (!current) throw new AdministrationFault('ACCOUNT_NOT_FOUND');
    if (current.account.role !== 'user' || current.account.userId === actor.account.userId)
      throw new AuthFault('FORBIDDEN');
    return current;
  }
  private async save(expected: AccountRead, next: UserAccount): Promise<AccountRead> {
    let result;
    try { result = await this.o.users.compareAndSwap(expected, next); }
    catch { throw new AdministrationFault('ACCOUNT_WRITE_UNCERTAIN'); }
    if (result.outcome === 'conflict') throw new AdministrationFault('ACCOUNT_CONFLICT');
    if (result.outcome === 'uncertain') throw new AdministrationFault('ACCOUNT_WRITE_UNCERTAIN');
    return result.value;
  }
  private async cleanupDeactivated(account: Readonly<UserAccount>): Promise<void> {
    const deadline = Date.now() + 10000;
    const revoke = async () => {
      const provider = this.o.provider;
      if (!provider) return;
      const revoked = new Set<string>();
      const revokeOne = async (sid: string) => {
        if (Date.now() >= deadline || revoked.has(sid)) return;
        revoked.add(sid);
        try { await provider.revoke(sid); } catch { /* Local SID/status fence is authoritative. */ }
      };
      if (account.currentWorkosSessionId) await revokeOne(account.currentWorkosSessionId);
      let cursor: string | undefined;
      const cursors = new Set<string>();
      // ponytail: at most 300 listed sessions per deactivation; repeat command/operator cleanup if this ceiling is reached.
      for (let page = 0; page < 3 && Date.now() < deadline; page++) {
        const result = await provider.listSessions(account.workosUserId, cursor);
        for (const sid of result.ids.slice(0, 100)) await revokeOne(sid);
        if (!result.nextCursor || cursors.has(result.nextCursor)) return;
        cursor = result.nextCursor; cursors.add(cursor);
      }
    };
    await boundedResult(Promise.allSettled([
      Promise.resolve().then(() => this.o.onUserDeactivated?.(account.userId)),
      Promise.resolve().then(revoke),
    ]), 10000);
  }
  async deactivate(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<AdministrationUserResponse> {
    const current = await this.target(principal, userId, body);
    const saved = current.account.status === 'inactive' && current.account.currentWorkosSessionId === null
      ? current : await this.save(current, { ...invalidateAccount(current.account, this.now().toISOString()), status: 'inactive' });
    // A crash between commit and callback is repaired by repeating deactivate, not a new event-delivery subsystem.
    await this.cleanupDeactivated(current.account);
    return { user: row(saved.account) };
  }
  async reactivate(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<AdministrationUserResponse> {
    const current = await this.target(principal, userId, body);
    const saved = current.account.status === 'active' ? current : await this.save(current,
      { ...current.account, status: 'active', currentWorkosSessionId: null, updatedAt: this.now().toISOString() });
    return { user: row(saved.account) };
  }
  async passwordReset(principal: AuthPrincipal | null, userId: string, body: unknown): Promise<void> {
    const current = await this.target(principal, userId, body);
    this.limiter.take('recovery', current.account.emailNormalized);
    try { await this.provider().sendRecovery(current.account.emailNormalized); }
    catch (error) { throw safeAdministrationFault(error); }
  }
}
