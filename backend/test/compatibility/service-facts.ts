/**
 * ============================================================================
 * FILE: service-facts.ts
 * LOCATION: backend/test/compatibility/service-facts.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Validate non-secret selected-service facts before Azure compatibility tests.
 *
 * ROLE IN PROJECT:
 *    Keeps the Azure suite fail-closed when partition keys, profile, or document
 *    limits are missing or incompatible with P2's supported intersection.
 *
 * KEY COMPONENTS:
 *    - parseServiceFacts: Strict JSON facts parser with partition-profile checks.
 * ============================================================================
 */

import { z } from 'zod';

const partition = z.enum(['unsharded', 'userId', 'sessionId', 'thread_id']);

const factsSchema = z
  .object({
    profile: z.enum(['cosmos-mongodb-ru', 'azure-documentdb', 'native-mongodb']),
    apiVersion: z.string().min(1).max(64),
    tier: z.string().min(1).max(128),
    consistency: z.string().min(1).max(128),
    backupMode: z.string().min(1).max(128),
    documentLimitBytes: z.number().int().min(2_000_000),
    capabilities: z.array(z.string().max(128)).max(32),
    partitions: z
      .object({
        sessions: partition,
        messages: partition,
        'agent-memory': partition,
        metadata: partition,
        checkpoints: partition,
        checkpoint_writes: partition,
      })
      .strict(),
  })
  .strict();

export function parseServiceFacts(input: string | undefined) {
  if (!input) {
    throw new Error('Selected-service facts are required; Azure is not certified.');
  }
  const facts = factsSchema.parse(JSON.parse(input));
  if (
    !['unsharded', 'userId'].includes(facts.partitions.sessions) ||
    ['messages', 'agent-memory', 'metadata'].some(
      (collection) =>
        !['unsharded', 'userId', 'sessionId'].includes(
          facts.partitions[collection as 'messages'],
        ),
    ) ||
    ['checkpoints', 'checkpoint_writes'].some(
      (collection) =>
        !['unsharded', 'thread_id'].includes(facts.partitions[collection as 'checkpoints']),
    )
  ) {
    throw new Error('Unsupported selected-service partition profile.');
  }
  return facts;
}
