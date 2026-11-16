/**
 * ============================================================================
 * FILE: calendar-policy.ts
 * LOCATION: backend/src/contracts/calendar-policy.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Define versioned policies, scopes, finite ceilings, and failure schemas for Google Calendar.
 *
 * ROLE IN PROJECT:
 *    Serves as the root policy authority for Google Calendar integrations, governing
 *    OAuth scopes, revision identifiers, resource limits, and error taxonomy.
 *
 * KEY COMPONENTS:
 *    - CALENDAR_SCOPES / CALENDAR_SCOPES_V1: Permitted OAuth scopes.
 *    - CALENDAR_TOOL_REVISION / CALENDAR_PROOF_REVISION / CALENDAR_CURSOR_VERSION: Revision identifiers.
 *    - CALENDAR_LIMITS / calendarLimitsSchema: Strict finite ceilings and schemas.
 *    - calendarGrantStatus / calendarGrantSchema: Validation of granted OAuth scopes.
 *    - calendarFailureSchema: Standard failure categories and retry taxonomy.
 * ============================================================================
 */

import { z } from 'zod';
import { decimalSchema } from './usage-evidence.js';

export const CALENDAR_SCHEMA_VERSION = 1 as const;
export const CALENDAR_SCHEMA_VERSION_V2 = 2 as const;
export const SKILL_PROTOCOL_VERSION = 'plugin-skills.v1' as const;
export const SKILL_SELECTION_LIMIT = 64;
export const CALENDAR_PLUGIN_ID = 'google-calendar' as const;
export const CALENDAR_TOOL_REVISION_V1 = 'google-calendar.v1' as const;
export const CALENDAR_TOOL_REVISION = 'google-calendar.v2' as const;
export const CALENDAR_PROOF_REVISION_V1 = 'google-calendar.events-owned.v1' as const;
export const CALENDAR_PROOF_REVISION = 'google-calendar.multi.v2' as const;
export const CALENDAR_CURSOR_VERSION = 2 as const;
export const CALENDAR_SCOPES_V1 = ['openid', 'email',
  'https://www.googleapis.com/auth/calendar.events.owned'] as const;
export const CALENDAR_SCOPES = ['openid', 'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy'] as const;
const forbiddenScopes = new Set(['https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.readonly']);
export const calendarGrantSchema = z.array(z.string().min(1).max(200)).max(10)
  .refine(scopes => new Set(scopes).size === scopes.length
    && !scopes.some(s => forbiddenScopes.has(s)));
export function calendarGrantStatus(scopes: readonly string[]): {
  state: 'complete' | 'reconnect-required'; missingScopes: string[];
} {
  const parsed = calendarGrantSchema.parse(scopes);
  const missingScopes = CALENDAR_SCOPES.filter(s => !parsed.includes(s));
  return { state: missingScopes.length ? 'reconnect-required' : 'complete', missingScopes };
}

export const CALENDAR_LIMITS = Object.freeze({ modelDispatches: 8, repairs: 2,
  logicalTools: 6, creates: 1, calendarRequests: 20, refreshRequests: 2,
  deliveryRetries: 2, eventsPerResult: 20, listDays: 31, argumentBytes: 16384,
  resultBytes: 16384, diagnosticCount: 10, diagnosticChars: 2048,
  toolTimeoutMs: 20000, modelSpendUsd: '1', sourceLifetimeMs: 86400000,
  auditLifetimeMs: 2592000000, oauthStateMs: 600000, jsonDepth: 8,
  retainedCalendars: 100, calendarsPerPage: 20, discoveryPagesInTurn: 2,
  discoveryPagesOutOfTurn: 10, availabilityCalendars: 100,
  availabilityBatchCalendars: 50, availabilityBatches: 2,
  busyIntervalsIngested: 2000, snapshotBytes: 262144,
  discoveryFreshnessMs: 300000, proposalLifetimeMs: 600000 });
const cap = (maximum: number) => z.number().int().positive().max(maximum);
export const calendarLimitsSchema = z.object({
  modelDispatches: cap(8), repairs: z.number().int().min(0).max(2), logicalTools: cap(6),
  creates: z.literal(1), calendarRequests: cap(20), refreshRequests: cap(2),
  deliveryRetries: z.number().int().min(0).max(2), eventsPerResult: cap(20), listDays: cap(31),
  argumentBytes: cap(16384), resultBytes: cap(16384), diagnosticCount: cap(10),
  diagnosticChars: cap(2048), toolTimeoutMs: cap(20000),
  modelSpendUsd: decimalSchema.refine(v => v === '1' || v.startsWith('0.')),
  sourceLifetimeMs: cap(86400000), auditLifetimeMs: cap(2592000000),
  oauthStateMs: cap(600000), jsonDepth: cap(8),
  retainedCalendars: cap(100).default(100), calendarsPerPage: cap(20).default(20),
  discoveryPagesInTurn: cap(2).default(2), discoveryPagesOutOfTurn: cap(10).default(10),
  availabilityCalendars: cap(100).default(100), availabilityBatchCalendars: cap(50).default(50),
  availabilityBatches: cap(2).default(2), busyIntervalsIngested: cap(2000).default(2000),
  snapshotBytes: cap(262144).default(262144), discoveryFreshnessMs: cap(300000).default(300000),
  proposalLifetimeMs: cap(600000).default(600000),
}).strict();
export type CalendarLimits = z.infer<typeof calendarLimitsSchema>;
export const calendarOptionsSchema = z.object({ enabled: z.boolean().default(false),
  limits: calendarLimitsSchema.default(CALENDAR_LIMITS),
  processingPolicyId: z.string().min(1).max(128).nullable().default(null),
}).strict();
export type CalendarOptions = z.infer<typeof calendarOptionsSchema>;
export const calendarFailureSchema = z.object({
  category: z.enum(['structural', 'policy', 'clarification', 'provider', 'credential',
    'delivery', 'uncertain', 'persistence', 'budget', 'cancelled']),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  retry: z.enum(['none', 'schema-repair', 'provider-rejection', 'delivery-same-id', 'readback']),
}).strict().superRefine((v, ctx) => {
  const allowed = v.retry === 'none'
    || (v.retry === 'schema-repair' && v.category === 'structural')
    || (v.retry === 'provider-rejection' && v.category === 'provider')
    || (v.retry === 'delivery-same-id' && v.category === 'delivery')
    || (v.retry === 'readback' && v.category === 'uncertain');
  if (!allowed) ctx.addIssue({ code: 'custom', message: 'Retry category mismatch.' });
});
export type CalendarFailure = z.infer<typeof calendarFailureSchema>;
