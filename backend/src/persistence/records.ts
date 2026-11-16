/**
 * ============================================================================
 * FILE: records.ts
 * LOCATION: backend/src/persistence/records.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide stable hashed identities, BSON/schema bounds, and internal record codecs.
 *
 * ROLE IN PROJECT:
 *    Gives P2 adapters one scoped identity and envelope convention so application
 *    documents stay bounded, strictly validated, and restart-safe without
 *    cross-collection transactions.
 *
 * KEY COMPONENTS:
 *    - key/graphThreadId: SHA-256 identities derived from JSON-encoded tuples.
 *    - bounded/decode: Strict P1 validation plus `_id`/`_revision` envelopes.
 *    - Internal schemas: Counters, reservations, acceptance, executor, generations.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { BSON, type Document } from 'mongodb';
import { z, type ZodType } from 'zod';
import { idSchema } from '../contracts/identifiers.js';
import { AppError } from '../platform/errors/app-error.js';
import { encodeAccountingMoney, decodeAccountingMoney } from './accounting-codec.js';

export function key(kind: string, ...parts: (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify([kind, ...parts])).digest('hex');
}

export const graphThreadId = (userId: string, sessionId: string): string =>
  key('thread', userId, sessionId);

export function normalizeDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new AppError('INVALID_REQUEST', 'Invalid date.');
  }
  return date.toISOString();
}

export function safeSequence(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError('STORAGE_BUDGET_EXCEEDED', 'Ordering capacity exceeded.');
  }
  return value;
}

export function assertBytes(doc: Document, limit: number): number {
  const bytes = BSON.calculateObjectSize(doc) + 256;
  if (bytes > Math.min(limit, 1_800_000)) {
    throw new AppError('STORAGE_BUDGET_EXCEEDED', 'The record is too large to save.');
  }
  return bytes;
}

export type StoredDocument = Document & { _id: string; _revision: number };

export function bounded<T extends Document>(
  schema: ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  id: string,
  limit: number,
): { record: T; doc: StoredDocument; bytes: number } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('INVALID_REQUEST', 'Invalid persistence record.');
  }
  const record = parsed.data;
  if ('sequence' in record) {
    safeSequence(record.sequence as number);
  }
  if ('contextVersion' in record) {
    safeSequence(record.contextVersion as number);
  }
  if ('execution' in record) {
    safeSequence((record.execution as { generation: number }).generation);
  }
  if ('messageRefs' in record) {
    for (const ref of record.messageRefs as { sequence: number }[]) {
      safeSequence(ref.sequence);
    }
  }
  if ('sourceRanges' in record) {
    for (const range of record.sourceRanges as {
      fromSequence: number;
      toSequence: number;
    }[]) {
      safeSequence(range.fromSequence);
      safeSequence(range.toSequence);
    }
  }
  const doc = encodeAccountingMoney({ ...record, _id: id, _revision: 0 });
  return { record, doc, bytes: assertBytes(doc, limit) };
}

export function decode<T>(schema: ZodType<T, z.ZodTypeDef, unknown>, doc: Document | null): T | null {
  if (!doc) {
    return null;
  }
  const { _id: ignoredId, _revision: ignoredRevision, ...payload } = doc;
  void ignoredId;
  void ignoredRevision;
  const parsed = schema.safeParse(decodeAccountingMoney(payload));
  if (!parsed.success) {
    throw new AppError('PERSISTENCE_ERROR', 'Saved chat data is unavailable.');
  }
  return parsed.data;
}

export const scopeSchema = z
  .object({ userId: idSchema, sessionId: idSchema })
  .strict();

const internalBase = {
  schemaVersion: z.literal(1),
  userId: idSchema,
  sessionId: idSchema,
};

export const counterSchema = z
  .object({
    ...internalBase,
    kind: z.literal('sequence-counter'),
    next: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const reservationSchema = z
  .object({
    ...internalBase,
    kind: z.literal('sequence-reservation'),
    reservationId: idSchema,
    start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    count: z.number().int().positive().max(80),
  })
  .strict();

export const acceptanceSchema = z
  .object({
    ...internalBase,
    kind: z.literal('acceptance'),
    turnId: idSchema,
    attemptId: idSchema,
    userMessageId: idSchema,
    payloadHash: z.string().length(64),
  })
  .strict();

export const EXECUTOR_SCOPE = {
  userId: '__aurvin_system__',
  sessionId: '__executor__',
} as const;

export const localBindingSchema = z.object({
  machineHash: z.string().regex(/^[a-f0-9]{64}$/),
  installationHash: z.string().regex(/^[a-f0-9]{64}$/),
  pid: z.number().int().positive().max(0xffffffff),
  creation: z.string().regex(/^[0-9]{1,20}$/),
  appName: z.string().regex(/^aurvin-local-[a-zA-Z0-9-]{1,64}$/),
  databaseHash: z.string().regex(/^[a-f0-9]{64}$/),
  guardHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type LocalBinding = z.infer<typeof localBindingSchema>;
export const LOCAL_MUTATION_MODE='local-mutation-v1' as const;
export const localExecutorSchema = z.object({
  mode: z.literal(LOCAL_MUTATION_MODE),
  released: z.boolean(),
  binding: localBindingSchema,
  mutation: z.discriminatedUnion('state',[
    z.object({ state:z.literal('idle'),token:z.null() }).strict(),
    z.object({ state:z.literal('busy'),token:idSchema }).strict(),
  ]),
  ancestors: z.array(idSchema).max(16),
  pending: z.boolean(),
}).strict().refine(v => (v.pending || v.ancestors.length === 0) && new Set(v.ancestors).size === v.ancestors.length);

export const executorSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('executor'),
    userId: z.literal(EXECUTOR_SCOPE.userId),
    sessionId: z.literal(EXECUTOR_SCOPE.sessionId),
    ownerId: idSchema,
    local: localExecutorSchema.optional(),
  })
  .strict();

export const generationSchema = z
  .object({
    ...internalBase,
    kind: z.literal('generation'),
    generationId: z.string().min(1).max(200),
    attemptId: idSchema,
  })
  .strict();
