/**
 * ============================================================================
 * FILE: tokens.ts
 * LOCATION: backend/src/platform/tokens.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Provide stable dependency-injection tokens for platform configuration.
 *
 * ROLE IN PROJECT:
 *    Lets Nest modules inject validated server-side values without coupling
 *    providers to environment parsing internals.
 *
 * KEY COMPONENTS:
 *    - AURVIN_CONFIG: Injection token for the validated application config.
 * ============================================================================
 */

export const AURVIN_CONFIG = Symbol.for('aurvin.config');
