/**
 * ============================================================================
 * FILE: admission-receipt.ts
 * LOCATION: backend/src/chat-runtime/admission-receipt.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define bounded, disposable in-memory admission receipts for fast stream attachment.
 *
 * ROLE IN PROJECT:
 *    Avoids repeating durable history reads, manifest validation, and sequence
 *    allocation when an HTTP client attaches to a freshly admitted turn in the
 *    same process.
 *
 * KEY COMPONENTS:
 *    - AdmissionReceipt: Nonsecret immutable context and evidence record.
 *    - isPinnedCheckpointId / mergeAdmissionSourceRecords: Refuse synthetic
 *      checkpoint tokens; reuse immutable rows and require refreshed refs.
 *    - AdmissionReceiptStore: Bounded cache (128 entries, <=2 MiB/entry, <=16 MiB total).
 * ============================================================================
 */

import type { Boundary } from '../agent/state.js';
import type { AgentMemoryManifest, MessageRef } from '../contracts/agent-memory.js';
import type { AttemptRecord } from '../contracts/attempt.js';
import type { AssembledContext, ResponseMode } from '../contracts/context.js';
import type { MessageRecord } from '../contracts/message.js';
import type { ConfirmedRecord } from '../persistence/confirmed-record.js';
import type { AcceptanceRecord } from '../persistence/ownership.js';

export type AdmissionReceipt = Readonly<{
  userId: string;
  sessionId: string;
  turnId: string;
  attemptId: string;
  executorId: string;
  releasedGeneration: number;
  expiresAt: number;
  attempt: ConfirmedRecord<AttemptRecord>;
  input: ConfirmedRecord<MessageRecord>;
  acceptance: AcceptanceRecord;
  reservation: Readonly<{ start: number; count: number }>;
  manifest: AgentMemoryManifest;
  sourceRecords: readonly MessageRecord[];
  refreshRefs: readonly MessageRef[];
  boundary: Boundary;
  /** Real LangGraph checkpoint id. `${sessionId}-0` is not authorization. */
  checkpointId: string;
  /** Untrusted compatibility field; never authorizes skipping reconstruction. */
  graphEpoch: number;
  responseMode: ResponseMode;
  configRevision: number;
  /** Store-bound manifest when getConfirmed was available at admission. */
  manifestReceipt?: ConfirmedRecord<AgentMemoryManifest>;
  /** Assembled context when reusable across same-process live voice attach. */
  assembledContext?: AssembledContext;
}>;

export function isPinnedCheckpointId(sessionId: string, checkpointId: string): boolean {
  return checkpointId.length > 0 && checkpointId.length <= 128 && checkpointId !== `${sessionId}-0`;
}

export function mergeAdmissionSourceRecords(
  manifest: AgentMemoryManifest,
  plainRecords: readonly MessageRecord[],
  refreshed: readonly MessageRecord[],
): MessageRecord[] | null {
  const byId = new Map<string, MessageRecord>();
  for (const row of plainRecords) byId.set(row.messageId, row);
  for (const row of refreshed) byId.set(row.messageId, row);
  const records: MessageRecord[] = [];
  for (const ref of manifest.messageRefs) {
    const row = byId.get(ref.messageId);
    if (
      !row ||
      row.eventId !== ref.eventId ||
      row.sequence !== ref.sequence ||
      row.userId !== manifest.userId ||
      row.sessionId !== manifest.sessionId
    ) {
      return null;
    }
    records.push(row);
  }
  return records;
}

export const ADMISSION_RECEIPT_LIMITS = {
  maxEntries: 128,
  maxEntryBytes: 2 * 1024 * 1024, // 2 MiB
  maxTotalBytes: 16 * 1024 * 1024, // 16 MiB
  defaultTtlMs: 60_000, // 60 seconds
} as const;

export class AdmissionReceiptStore {
  private readonly entries = new Map<string, { receipt: AdmissionReceipt; bytes: number }>();
  private totalBytes = 0;

  constructor(
    private readonly limits = ADMISSION_RECEIPT_LIMITS,
    private readonly clock: () => number = Date.now,
  ) {}

  private makeKey(userId: string, sessionId: string, attemptId: string): string {
    return JSON.stringify([userId, sessionId, attemptId]);
  }

  private pruneExpired(now: number): void {
    for (const [key, item] of this.entries.entries()) {
      if (now > item.receipt.expiresAt) {
        this.entries.delete(key);
        this.totalBytes = Math.max(0, this.totalBytes - item.bytes);
      }
    }
  }

  put(receipt: AdmissionReceipt): void {
    const now = this.clock();
    this.pruneExpired(now);

    let serialized: string;
    try {
      serialized = JSON.stringify(receipt);
    } catch {
      return;
    }

    const entryBytes = Buffer.byteLength(serialized, 'utf8');
    if (entryBytes > this.limits.maxEntryBytes) {
      return; // Do not cache oversized receipts; fall back to strict path
    }

    const key = this.makeKey(receipt.userId, receipt.sessionId, receipt.attemptId);
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes = Math.max(0, this.totalBytes - existing.bytes);
      this.entries.delete(key);
    }

    while (
      this.entries.size >= this.limits.maxEntries ||
      this.totalBytes + entryBytes > this.limits.maxTotalBytes
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.entries.get(oldestKey);
      if (oldest) {
        this.totalBytes = Math.max(0, this.totalBytes - oldest.bytes);
      }
      this.entries.delete(oldestKey);
    }

    this.entries.set(key, { receipt, bytes: entryBytes });
    this.totalBytes += entryBytes;
  }

  get(userId: string, sessionId: string, attemptId: string): AdmissionReceipt | null {
    const now = this.clock();
    const key = this.makeKey(userId, sessionId, attemptId);
    const item = this.entries.get(key);
    if (!item) return null;
    if (now > item.receipt.expiresAt) {
      this.entries.delete(key);
      this.totalBytes = Math.max(0, this.totalBytes - item.bytes);
      return null;
    }
    return item.receipt;
  }

  getByTurn(userId: string, sessionId: string, turnId: string): AdmissionReceipt | null {
    const now = this.clock();
    for (const [key, item] of this.entries.entries()) {
      if (item.receipt.userId === userId && item.receipt.sessionId === sessionId && item.receipt.turnId === turnId) {
        if (now > item.receipt.expiresAt) {
          this.entries.delete(key);
          this.totalBytes = Math.max(0, this.totalBytes - item.bytes);
          return null;
        }
        return item.receipt;
      }
    }
    return null;
  }

  delete(userId: string, sessionId: string, attemptId?: string): void {
    if (attemptId) {
      const key = this.makeKey(userId, sessionId, attemptId);
      const item = this.entries.get(key);
      if (item) {
        this.entries.delete(key);
        this.totalBytes = Math.max(0, this.totalBytes - item.bytes);
      }
      return;
    }
    for (const [key, item] of this.entries.entries()) {
      if (item.receipt.userId === userId && item.receipt.sessionId === sessionId) {
        this.entries.delete(key);
        this.totalBytes = Math.max(0, this.totalBytes - item.bytes);
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.totalBytes;
  }
}
