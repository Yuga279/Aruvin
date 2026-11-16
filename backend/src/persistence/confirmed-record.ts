/**
 * ============================================================================
 * FILE: confirmed-record.ts
 * LOCATION: backend/src/persistence/confirmed-record.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Mint and verify opaque WeakMap-backed persistence confirmation receipts.
 *
 * ROLE IN PROJECT:
 *    Carries a store-acknowledged record and hidden storage envelope (_id,
 *    _revision, private claims) across sequential CAS transitions without
 *    trusting client/caller-forged revisions or mutating public records.
 *
 * KEY COMPONENTS:
 *    - ConfirmedRecord / CasConfirmation: Opaque receipt and CAS result types.
 *    - issueConfirmedRecord: Mints a deep-frozen receipt bound to a RecordStore.
 *    - inspectConfirmedRecord: Validates store, collection, id, and canonical payload.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import { BSON } from 'mongodb';
import { AppError } from '../platform/errors/app-error.js';
import type { StoredDocument } from './records.js';
import type { RecordStore } from './store.js';

declare const confirmation: unique symbol;

export type ConfirmedRecord<T> = Readonly<{
  record: Readonly<T>;
  [confirmation]: true;
}>;

export type CasConfirmation<T> =
  | { outcome: 'confirmed'; receipt: ConfirmedRecord<T> }
  | { outcome: 'conflict' | 'uncertain' };

export type ConfirmedEnvelope<T> = {
  readonly store: RecordStore;
  readonly collection: string;
  readonly id: string;
  readonly revision: number;
  readonly canonical: Readonly<T>;
  readonly encoded: StoredDocument;
};

const envelopes = new WeakMap<object, ConfirmedEnvelope<unknown>>();

function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return Object.freeze(value);
}

export function issueConfirmedRecord<T>(input: {
  store: RecordStore;
  collection: string;
  id: string;
  revision: number;
  record: T;
  encoded: StoredDocument;
}): ConfirmedRecord<T> {
  const publicRecord = deepFreeze(structuredClone(input.record));
  const canonical = deepFreeze(structuredClone(input.record));
  const encoded = BSON.deserialize(BSON.serialize(input.encoded)) as StoredDocument;
  const receipt = Object.freeze({ record: publicRecord }) as unknown as ConfirmedRecord<T>;
  envelopes.set(receipt, {
    store: input.store,
    collection: input.collection,
    id: input.id,
    revision: input.revision,
    canonical,
    encoded,
  });
  return receipt;
}

export function inspectConfirmedRecord<T>(
  receipt: unknown,
  expected: {
    store: RecordStore;
    collection?: string;
    id?: string;
  },
): ConfirmedEnvelope<T> {
  if (!receipt || typeof receipt !== 'object') {
    throw new AppError('INVALID_REQUEST', 'Invalid persistence receipt.');
  }
  const envelope = envelopes.get(receipt);
  if (
    !envelope ||
    envelope.store !== expected.store ||
    (expected.collection !== undefined && envelope.collection !== expected.collection) ||
    (expected.id !== undefined && envelope.id !== expected.id) ||
    !isDeepStrictEqual((receipt as { record?: unknown }).record, envelope.canonical)
  ) {
    throw new AppError('INVALID_REQUEST', 'Invalid persistence receipt.');
  }
  return envelope as ConfirmedEnvelope<T>;
}
