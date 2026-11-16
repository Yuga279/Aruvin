/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/contracts/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Re-export the public Aurvin contract surface from one stable entry point.
 *
 * ROLE IN PROJECT:
 *    Allows downstream backend modules to consume shared versioned schemas and
 *    interfaces without coupling to implementation-specific file layout.
 *
 * KEY COMPONENTS:
 *    - Contract exports: Shared schemas, data shapes, versions, and ports.
 * ============================================================================
 */

export * from './admin-config-wire.js';
export * from './admin-config.js';
export * from './administration.js';
export * from './agent-memory.js';
export * from './auth.js';
export * from './api.js';
export * from './attempt.js';
export * from './budgets.js';
export * from './collections.js';
export * from './config-runtime.js';
export * from './context.js';
export * from './errors.js';
export * from './identifiers.js';
export * from './identity.js';
export * from './message.js';
export * from './metadata.js';
export * from './persistence-profile.js';
export * from './repositories.js';
export * from './runtime.js';
export * from './session.js';
export * from './stream.js';
export * from './versions.js';
export * from './voice-wire.js';
export * from './voice-audio.js';
export * from './voice.js';
export * from './calendar-policy.js';
export * from './calendar-tools.js';
export * from './calendar-sources.js';
export * from './calendar-connections.js';
export * from './calendar-operations.js';
export * from './calendar-accounting.js';
export * from './calendar-model.js';
export * from './calendar-wire.js';
