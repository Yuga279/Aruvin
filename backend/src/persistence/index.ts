/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/persistence/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export the public P2 persistence surface for downstream workers.
 *
 * ROLE IN PROJECT:
 *    Lets P5/P8/P9 consume concrete adapters and the native bundle without
 *    depending on internal file layout.
 *
 * KEY COMPONENTS:
 *    - Repository adapters: Sessions, messages, memory, metadata, ownership.
 *    - Checkpoint factory/saver and persistence open/bundle helpers.
 *    - Calendar v2 multi-calendar adapters, proposals, and migration utilities.
 * ============================================================================
 */

export { MongoCheckpointFactory, ScopedMongoSaver } from './checkpoints.js';
export { MongoConfigRepository } from './config.js';
export { MongoMemory } from './memory.js';
export { MongoMessages } from './messages.js';
export { MongoMetadata } from './metadata.js';
export { MongoOwnership } from './ownership.js';
export {
  createPersistenceBundle,
  openPersistence,
  type PersistenceBundle,
} from './persistence.js';
export { graphThreadId } from './records.js';
export { MongoSessions } from './sessions.js';
export { MongoUsers } from './users.js';
export { MongoCalendarConnections } from './calendar-connections.js';
export { MongoCalendarOperations } from './calendar-operations.js';
export { MongoCalendarDecisions, MongoCalendarResults } from './calendar-evidence.js';
export { MongoCalendarAccounting } from './calendar-accounting.js';
export { MongoCalendarRetention } from './calendar-retention.js';
export { MongoCalendarProposals } from './calendar-proposals.js';
export { projectLegacyCalendarConnection, assessCalendarRollback } from './calendar-migration.js';
export {
  assertCalendarCheckpointSafe,
  calendarCheckpointRefsSchema,
  calendarCheckpointRefsV2Schema,
} from './calendar-checkpoints.js';
export {
  redactCalendarMessage, redactCalendarDecision, redactCalendarResult,
  redactCalendarOperation,
  connectionKey, oauthKey, operationKey, budgetKey,
} from './calendar-records.js';
export { CalendarSecretCipher } from '../platform/crypto/calendar-secret-cipher.js';
