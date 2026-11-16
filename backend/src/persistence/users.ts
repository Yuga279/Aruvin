/**
 * ============================================================================
 * FILE: users.ts
 * LOCATION: backend/src/persistence/users.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persist bounded local accounts with confirmed reads and identity CAS.
 *
 * ROLE IN PROJECT:
 *    Owns Aurvin userId/role/status/session binding on the admitted Mongo
 *    connection without storing credentials or implementing Administration.
 *
 * KEY COMPONENTS:
 *    - MongoUsers: Confirmed insert/lookup and immutable-identity compareAndSwap.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { administrationPageQuerySchema } from '../contracts/administration.js';
import {
  userAccountSchema,
  type AccountRead,
  type UserAccount,
  type UserCasResult,
  type UsersPage,
  type UsersRepository,
} from '../contracts/auth.js';
import { idSchema, isoDateSchema } from '../contracts/identifiers.js';
import { AppError } from '../platform/errors/app-error.js';
import { inspectConfirmedRecord } from './confirmed-record.js';
import type { MongoOwnership } from './ownership.js';
import { assertBytes, bounded, decode } from './records.js';
import type { RecordStore } from './store.js';

export class MongoUsers implements UsersRepository {
  constructor(private readonly store: RecordStore,
    private readonly owner: Pick<MongoOwnership, 'assertExecutor'>,
    private readonly byteLimit: number) {}
  private async lookup(filter: Record<string, string>): Promise<AccountRead | null> {
    const raw = await this.store.raw('users', filter);
    if (!raw) return null;
    assertBytes(raw, this.byteLimit);
    const value = decode(userAccountSchema, raw)!;
    if (raw._id !== value.userId || !Number.isSafeInteger(raw._revision) || raw._revision < 0)
      throw new AppError('PERSISTENCE_ERROR', 'Account data is unavailable.');
    return { account: value, revision: raw._revision };
  }
  get(userId: string) { return this.lookup({ _id: idSchema.parse(userId) }); }
  bySubject(workosUserId: string) { return this.lookup({ workosUserId: idSchema.parse(workosUserId) }); }
  byEmail(emailNormalized: string) { return this.lookup({ emailNormalized }); }
  async insert(value: UserAccount): Promise<AccountRead> {
    bounded(userAccountSchema, value, value.userId, this.byteLimit);
    await this.owner.assertExecutor();
    const receipt = await this.store.insertConfirmed('users', userAccountSchema, value, value.userId, this.byteLimit);
    await this.owner.assertExecutor();
    const envelope = inspectConfirmedRecord<UserAccount>(receipt, { store: this.store, collection: 'users', id: value.userId });
    return { account: receipt.record as UserAccount, revision: envelope.revision };
  }
  async compareAndSwap(expected: AccountRead, next: UserAccount): Promise<UserCasResult> {
    const previous = expected.account;
    if (next.userId !== previous.userId || next.workosUserId !== previous.workosUserId ||
        next.emailNormalized !== previous.emailNormalized || next.role !== previous.role || next.createdAt !== previous.createdAt)
      throw new AppError('INVALID_REQUEST', 'Account identity cannot be changed.');
    bounded(userAccountSchema, next, previous.userId, this.byteLimit);
    await this.owner.assertExecutor();
    const receipt = await this.store.readConfirmed('users', userAccountSchema, { _id: previous.userId });
    if (!receipt) return { outcome: 'conflict' };
    const inspected = inspectConfirmedRecord<UserAccount>(receipt, { store: this.store, collection: 'users', id: previous.userId });
    if (inspected.revision !== expected.revision || !isDeepStrictEqual(inspected.canonical, previous)) return { outcome: 'conflict' };
    if (next.sessionEpoch < previous.sessionEpoch) throw new AppError('INVALID_REQUEST', 'Invalid account version.');
    const result = await this.store.replaceConfirmed(receipt, userAccountSchema, next, this.byteLimit);
    if (result.outcome !== 'confirmed') return result;
    try { await this.owner.assertExecutor(); } catch { return { outcome: 'uncertain' }; }
    return { outcome: 'confirmed', value: { account: result.receipt.record as UserAccount, revision: expected.revision + 1 } };
  }
  async list(options: { limit?: number; cursor?: string } = {}): Promise<UsersPage> {
    const parsed = administrationPageQuerySchema.parse(options);
    const limit = parsed.limit ?? 20;
    let filter: Record<string, unknown> = {};
    if (parsed.cursor) {
      let tuple: unknown;
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(parsed.cursor)) throw new Error('cursor');
        const bytes = Buffer.from(parsed.cursor, 'base64url');
        if (bytes.toString('base64url') !== parsed.cursor) throw new Error('cursor');
        tuple = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch { throw new AppError('INVALID_REQUEST', 'Invalid account page.'); }
      const [createdAt, userId] = z.tuple([isoDateSchema, idSchema]).parse(tuple);
      filter = { $or: [{ createdAt: { $lt: createdAt } }, { createdAt, userId: { $lt: userId } }] };
    }
    const rows = await this.store.collection('users').find(filter, this.store.options())
      .sort({ createdAt: -1, userId: -1 }).limit(limit + 1).toArray();
    const visible = rows.slice(0, limit);
    const items = visible.map(raw => {
      assertBytes(raw, this.byteLimit);
      const value = decode(userAccountSchema, raw)!;
      if (raw._id !== value.userId || !Number.isSafeInteger(raw._revision) || raw._revision < 0)
        throw new AppError('PERSISTENCE_ERROR', 'Account data is unavailable.');
      return { account: value, revision: raw._revision };
    });
    const last = items.at(-1)?.account;
    return { items, nextCursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify([last.createdAt, last.userId])).toString('base64url') : null };
  }
}
