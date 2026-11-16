/**
 * ============================================================================
 * FILE: memory.ts
 * LOCATION: backend/src/persistence/memory.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Persist monotonic reference-only agent-memory manifests.
 *
 * ROLE IN PROJECT:
 *    Stores bounded context selection documents that point at original message
 *    records instead of copying transcript content.
 *
 * KEY COMPONENTS:
 *    - MongoMemory.get: Scoped manifest lookup.
 *    - MongoMemory.put: Immutable first write or +1 contextVersion CAS.
 * ============================================================================
 */

import { isDeepStrictEqual } from 'node:util';
import {
  agentMemoryManifestSchema,
  type AgentMemoryManifest,
} from '../contracts/agent-memory.js';
import type { BudgetConfig } from '../contracts/budgets.js';
import type { AgentMemoryRepository } from '../contracts/repositories.js';
import { AppError } from '../platform/errors/app-error.js';
import { inspectConfirmedRecord, type ConfirmedRecord } from './confirmed-record.js';
import { bounded, key } from './records.js';
import { RecordStore } from './store.js';

export class MongoMemory implements AgentMemoryRepository {
  constructor(
    readonly store: RecordStore,
    readonly budgets: BudgetConfig,
  ) {}

  getConfirmed(
    userId: string,
    sessionId: string,
  ): Promise<ConfirmedRecord<AgentMemoryManifest> | null> {
    return this.store.readConfirmed('agent-memory', agentMemoryManifestSchema, {
      _id: key('memory', userId, sessionId),
      userId,
      sessionId,
    });
  }

  get(userId: string, sessionId: string) {
    return this.store.read('agent-memory', agentMemoryManifestSchema, {
      _id: key('memory', userId, sessionId),
      userId,
      sessionId,
    });
  }

  async putConfirmed(
    manifest: AgentMemoryManifest,
    expected?: ConfirmedRecord<AgentMemoryManifest>,
  ): Promise<ConfirmedRecord<AgentMemoryManifest>> {
    const id = key('memory', manifest.userId, manifest.sessionId);
    const { record } = bounded(
      agentMemoryManifestSchema,
      manifest,
      id,
      this.budgets.maxManifestBytes,
    );
    if (
      record.activeSummaryRef !== null ||
      record.sourceRanges.some((range) => range.fromSequence > range.toSequence) ||
      new Set(record.messageRefs.map((ref) => ref.messageId)).size !==
        record.messageRefs.length ||
      record.messageRefs.some(
        (ref, index) => index > 0 && ref.sequence <= record.messageRefs[index - 1].sequence,
      )
    ) {
      throw new AppError('INVALID_REQUEST', 'Invalid context manifest.');
    }
    const prior = expected !== undefined
      ? (() => {
          inspectConfirmedRecord<AgentMemoryManifest>(expected, {
            store: this.store,
            collection: 'agent-memory',
            id,
          });
          return expected;
        })()
      : await this.getConfirmed(record.userId, record.sessionId);
    if (!prior) {
      return this.store.insertConfirmed(
        'agent-memory',
        agentMemoryManifestSchema,
        record,
        id,
        this.budgets.maxManifestBytes,
      );
    }
    const old = prior.record;
    if (isDeepStrictEqual(old, record)) {
      return prior;
    }
    if (record.contextVersion !== old.contextVersion + 1) {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Context changed while saving.');
    }
    const replaced = await this.store.replaceConfirmed(
      prior,
      agentMemoryManifestSchema,
      record,
      this.budgets.maxManifestBytes,
    );
    if (replaced.outcome !== 'confirmed') {
      throw new AppError('CONFLICT_ACTIVE_TURN', 'Context changed while saving.');
    }
    return replaced.receipt;
  }

  async put(manifest: AgentMemoryManifest): Promise<void> {
    await this.putConfirmed(manifest);
  }
}
