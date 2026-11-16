/**
 * ============================================================================
 * FILE: collections.ts
 * LOCATION: backend/src/contracts/collections.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Name the seven bounded persistence collections used by Aurvin.
 *
 * ROLE IN PROJECT:
 *    Gives persistence adapters and downstream modules one shared source of
 *    collection identifiers without selecting a concrete database service.
 *
 * KEY COMPONENTS:
 *    - COLLECTIONS: Stable names for application and checkpoint records.
 *    - CollectionName: Union of the supported collection names.
 * ============================================================================
 */

export const COLLECTIONS = {
  sessions: 'sessions',
  messages: 'messages',
  agentMemory: 'agent-memory',
  metadata: 'metadata',
  checkpoints: 'checkpoints',
  checkpointWrites: 'checkpoint_writes',
  config: 'config',
  integrationConnections: 'integration_connections',
  users: 'users',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
