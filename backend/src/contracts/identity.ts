/**
 * ============================================================================
 * FILE: identity.ts
 * LOCATION: backend/src/contracts/identity.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define the server-resolved identity shape and its resolver interface.
 *
 * ROLE IN PROJECT:
 *    Keeps user attribution independent of client request bodies and requires
 *    the same resolved identity to be available for provider attribution.
 *
 * KEY COMPONENTS:
 *    - resolvedIdentitySchema: Validates identity and attribution fields.
 *    - IdentityResolver: Server-side identity resolution port.
 * ============================================================================
 */

import { z } from 'zod';
import { idSchema } from './identifiers.js';

export const resolvedIdentitySchema = z
  .object({
    userId: idSchema,
    /** @deprecated P3 removes this compile bridge at application auth cutover. */
    source: z.enum(['server-configured', 'authenticated-session', 'bootstrap-operator']),
    openRouterUser: idSchema,
  })
  .strict();

export type ResolvedIdentity = z.infer<typeof resolvedIdentitySchema>;

export interface IdentityResolver {
  resolve(): ResolvedIdentity;
}
