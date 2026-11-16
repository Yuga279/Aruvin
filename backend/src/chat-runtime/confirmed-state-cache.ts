/**
 * ============================================================================
 * FILE: confirmed-state-cache.ts
 * LOCATION: backend/src/chat-runtime/confirmed-state-cache.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Bounded, in-memory cache of confirmed post-finalization chat state for fast turn follow-ups.
 *
 * ROLE IN PROJECT:
 *    Avoids redundant MongoDB queries (agent-memory manifest reads, LangGraph
 *    checkpoint reads, and immutable message reference fetches) on consecutive
 *    turns in the same process by safely reusing latest confirmed state.
 *
 * KEY COMPONENTS:
 *    - ConfirmedSessionState: Nonsecret confirmed manifest, boundary, and message records.
 *    - ConfirmedStateCache: Bounded LRU/FIFO store (128 entries, <=2 MiB/entry, <=16 MiB total).
 * ============================================================================
 */

import type { AgentMemoryManifest, MessageRef } from '../contracts/agent-memory.js';
import type { MessageRecord } from '../contracts/message.js';
import type { ConfirmedRecord } from '../persistence/confirmed-record.js';

export type ConfirmedSessionState = Readonly<{
  userId: string;
  sessionId: string;
  executorId: string;
  sessionGeneration: number;
  turnId: string;
  attemptId: string;
  manifest: AgentMemoryManifest;
  checkpointId: string;
  plainRecords: readonly MessageRecord[];
  refreshRefs: readonly MessageRef[];
  instructionVersion: string;
  knowledgeContentHash: string;
  graphSchemaVersion: string;
  confirmedAt: number;
  expiresAt: number;
  manifestReceipt?: ConfirmedRecord<AgentMemoryManifest> | null;
  calendarMessageIds?: readonly string[];
}>;

export const CONFIRMED_STATE_LIMITS = {
  maxEntries: 128,
  maxEntryBytes: 2 * 1024 * 1024, // 2 MiB
  maxTotalBytes: 16 * 1024 * 1024, // 16 MiB
  defaultTtlMs: 300_000, // 5 minutes (eviction ceiling; validity tied to generation/hashes)
} as const;

export class ConfirmedStateCache {
  private readonly entries = new Map<string, { state: ConfirmedSessionState; bytes: number }>();
  private totalBytes = 0;

  constructor(
    private readonly limits = CONFIRMED_STATE_LIMITS,
    private readonly clock: () => number = Date.now,
  ) {}

  private makeKey(userId: string, sessionId: string): string {
    return `${userId}:${sessionId}`;
  }

  private pruneExpired(now: number): void {
    for (const [key, item] of this.entries.entries()) {
      if (now > item.state.expiresAt) {
        this.entries.delete(key);
        this.totalBytes = Math.max(0, this.totalBytes - item.bytes);
      }
    }
  }

  put(state: ConfirmedSessionState): void {
    const now = this.clock();
    this.pruneExpired(now);

    let serialized: string;
    try {
      serialized = JSON.stringify(state);
    } catch {
      return;
    }

    const entryBytes = Buffer.byteLength(serialized, 'utf8');
    if (entryBytes > this.limits.maxEntryBytes) {
      return; // Do not cache oversized entries; fall back to strict path
    }

    const key = this.makeKey(state.userId, state.sessionId);
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

    this.entries.set(key, { state, bytes: entryBytes });
    this.totalBytes += entryBytes;
  }

  get(userId: string, sessionId: string): ConfirmedSessionState | null {
    const now = this.clock();
    const key = this.makeKey(userId, sessionId);
    const item = this.entries.get(key);
    if (!item) return null;
    if (now > item.state.expiresAt) {
      this.entries.delete(key);
      this.totalBytes = Math.max(0, this.totalBytes - item.bytes);
      return null;
    }
    return item.state;
  }

  delete(userId: string, sessionId: string): void {
    const key = this.makeKey(userId, sessionId);
    const item = this.entries.get(key);
    if (item) {
      this.entries.delete(key);
      this.totalBytes = Math.max(0, this.totalBytes - item.bytes);
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
