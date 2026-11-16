/**
 * ============================================================================
 * FILE: index.ts
 * LOCATION: backend/src/platform/index.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Re-export public platform primitives from one stable entry point.
 *
 * ROLE IN PROJECT:
 *    Provides downstream Nest modules a focused configuration, identity, error,
 *    redaction, and hashing surface without coupling to internal file layout.
 *
 * KEY COMPONENTS:
 *    - Platform exports: Module, config APIs, identity, and utility functions.
 * ============================================================================
 */

export { AppError } from './errors/app-error.js';
export { hashPayload } from './crypto/hash-payload.js';
export {
  loadConfig,
  readinessIssues,
  type AurvinConfig,
} from './config/load-config.js';
export { PlatformModule } from './platform.module.js';
export { redactSecrets } from './security/redact.js';
export { RequestIdentityStore } from './identity/request-identity-store.js';
export { ServerIdentityResolver } from './identity/server-identity-resolver.js';
export { AURVIN_CONFIG } from './tokens.js';
export { loadVoiceConfig, publicVoiceConfig, voiceReadinessIssues,
  type VoiceConfig } from './config/voice-config.js';
