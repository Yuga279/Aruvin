/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/operations/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Export the P9 public operations surface only.
 *
 * ROLE IN PROJECT:
 *    Gives application assembly one Telemetry, observed persistence, service,
 *    module, admission middleware, and operator recovery helpers.
 *
 * KEY COMPONENTS:
 *    - OperationsModule / OperationsService / configureOperations.
 *    - Telemetry, observePersistence, handoffVerifiedStopped, reconcilePage.
 * ============================================================================
 */

export { OperationsModule } from './operations.module.js';
export { OperationsService } from './operations.service.js';
export { configureOperations } from './configure-operations.js';
export { Telemetry, writeStdoutLog } from './telemetry.js';
export { observePersistence } from './observe-persistence.js';
export { handoffVerifiedStopped,reconcilePage } from './recovery.js';
export type { OperationsOptions } from './options.js';
