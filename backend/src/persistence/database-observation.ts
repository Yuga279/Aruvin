/**
 * ============================================================================
 * FILE: database-observation.ts
 * LOCATION: backend/src/persistence/database-observation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Count bounded, sanitized native database command observations.
 *
 * ROLE IN PROJECT:
 *    Observes the existing MongoDB client without retaining command bodies.
 *
 * KEY COMPONENTS:
 *    - observeDatabaseCommands: Tracks finite in-flight command metadata.
 * ============================================================================
 */
import type { EventEmitter } from 'node:events';
import type { CommandStartedEvent, CommandSucceededEvent, CommandFailedEvent,
  ConnectionCheckedOutEvent, ConnectionCheckOutFailedEvent } from 'mongodb';
import type { Telemetry } from '../operations/telemetry.js';

export type DatabasePhase = 'admission' | 'attachment' | 'context' | 'model-observation'
  | 'tool-evidence' | 'seal' | 'publication' | 'release' | 'recovery' | 'other';
export const DATABASE_COMMANDS = ['find', 'getMore', 'aggregate', 'count', 'distinct',
  'insert', 'update', 'delete', 'findAndModify', 'bulkWrite', 'other'] as const;
export type DatabaseCommand = typeof DATABASE_COMMANDS[number];
export type DatabaseOrigin = 'repository' | 'ownership' | 'checkpoint' | 'other';
export const DATABASE_COLLECTIONS = ['sessions','messages','agent-memory','metadata','checkpoints',
  'checkpoint_writes','integration_connections','other'] as const;
export type DatabaseCollection = typeof DATABASE_COLLECTIONS[number];
export type CommandSource = Pick<EventEmitter, 'on' | 'off'>;

const reads = new Set(['find', 'getMore', 'aggregate', 'count', 'distinct']);
const writes = new Set(['insert', 'update', 'delete', 'findAndModify', 'bulkWrite']);

export function observeDatabaseCommands(source: CommandSource, databaseName: string, telemetry: Telemetry): () => void {
  const pending = new Map<number, { started: number; kind: 'read' | 'write' | 'other';
    command: DatabaseCommand; scope: (job: () => void) => void; endInterval: () => void; collection: DatabaseCollection }>();
  const started = (event: CommandStartedEvent) => {
    try {
      if (!event || event.databaseName !== databaseName || !Number.isSafeInteger(event.requestId) || event.requestId < 0) return;
      if (!reads.has(event.commandName) && !writes.has(event.commandName) && event.commandName !== 'killCursors') return;
      const now = telemetry.monotonic();
      // In insertion order, so stop as soon as the oldest remaining entry is fresh.
      for (const [id, entry] of pending) {
        if (now - entry.started <= 120_000) break;
        pending.delete(id); entry.endInterval(); telemetry.measure('mongo_observation_dropped');
      }
      if (pending.size >= 4096 || pending.has(event.requestId)) {
        telemetry.measure('mongo_observation_dropped'); return;
      }
      const field = event.commandName === 'getMore' ? 'collection' : event.commandName;
      const rawCollection: unknown = event.command?.[field];
      const collection = DATABASE_COLLECTIONS.find(value => value === rawCollection) ?? 'other';
      const command = DATABASE_COMMANDS.find(value => value === event.commandName) ?? 'other';
      pending.set(event.requestId, { started: now, collection, command, kind: reads.has(event.commandName) ? 'read'
        : writes.has(event.commandName) ? 'write' : 'other',
        scope: telemetry.captureDatabaseScope(), endInterval:telemetry.beginMongoInterval() });
    } catch { /* Diagnostics must never affect database operations. */ }
  };
  const finished = (event: CommandSucceededEvent | CommandFailedEvent, failed: boolean) => {
    try {
      const entry = pending.get(event.requestId);
      if (!entry) return;
      pending.delete(event.requestId);
      entry.endInterval();
      entry.scope(() => {
        telemetry.recordMongoCommand(entry.kind, event.duration, failed, entry.collection, entry.command);
      });
    } catch { /* Diagnostics must never affect database operations. */ }
  };
  const succeeded = (event: CommandSucceededEvent) => finished(event, false);
  const failed = (event: CommandFailedEvent) => finished(event, true);
  const pool = (event: ConnectionCheckedOutEvent | ConnectionCheckOutFailedEvent) => {
    try { telemetry.measure('mongo_pool_wait', event.durationMS); } catch { /* Diagnostics are non-authoritative. */ }
  };
  const dispose = () => {
    try { source.off('commandStarted', started); } catch { /* Ignore diagnostic cleanup errors. */ }
    try { source.off('commandSucceeded', succeeded); } catch { /* Ignore diagnostic cleanup errors. */ }
    try { source.off('commandFailed', failed); } catch { /* Ignore diagnostic cleanup errors. */ }
    try { source.off('connectionCheckedOut', pool); } catch { /* Ignore diagnostic cleanup errors. */ }
    try { source.off('connectionCheckOutFailed', pool); } catch { /* Ignore diagnostic cleanup errors. */ }
    for (const entry of pending.values()) entry.endInterval();
    pending.clear();
  };
  try {
    source.on('commandStarted', started);
    source.on('commandSucceeded', succeeded);
    source.on('commandFailed', failed);
    source.on('connectionCheckedOut', pool);
    source.on('connectionCheckOutFailed', pool);
  } catch { dispose(); }
  return dispose;
}
