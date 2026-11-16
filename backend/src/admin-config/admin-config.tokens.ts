/**
 * ============================================================================
 * FILE: admin-config.tokens.ts
 * LOCATION: backend/src/admin-config/admin-config.tokens.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Hold the Nest injection token for the server-resolved admin actor.
 *
 * ROLE IN PROJECT:
 *    Lets the independently registered module inject the same actor closure
 *    without creating persistence or reading client identity headers.
 *
 * KEY COMPONENTS:
 *    - ADMIN_CONFIG_ACTOR: Provider token for () => AdminConfigActor.
 * ============================================================================
 */

export const ADMIN_CONFIG_ACTOR = Symbol('ADMIN_CONFIG_ACTOR');
