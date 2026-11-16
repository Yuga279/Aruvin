import { describe, expect, it } from 'vitest';
import { CALENDAR_LIMITS, calendarLimitsSchema, calendarOptionsSchema,
  calendarFailureSchema, CALENDAR_SCOPES, CALENDAR_SCOPES_V1 } from '../../src/contracts/calendar-policy.js';

describe('Calendar proof policy', () => {
  it('freezes approved finite ceilings and starts disabled', () => {
    expect(CALENDAR_LIMITS).toMatchObject({ modelDispatches: 8, repairs: 2, logicalTools: 6,
      creates: 1, calendarRequests: 20, refreshRequests: 2, deliveryRetries: 2,
      eventsPerResult: 20, listDays: 31, argumentBytes: 16384, resultBytes: 16384,
      diagnosticCount: 10, diagnosticChars: 2048, toolTimeoutMs: 20000,
      modelSpendUsd: '1', sourceLifetimeMs: 86400000, auditLifetimeMs: 2592000000,
      oauthStateMs: 600000, jsonDepth: 8 });
    expect(calendarOptionsSchema.parse({}).enabled).toBe(false);
    expect(CALENDAR_SCOPES).toHaveLength(5);
    expect(CALENDAR_SCOPES_V1).toHaveLength(3);
    for (const [key, value] of Object.entries(CALENDAR_LIMITS)) {
      if (typeof value === 'number') {
        expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: value + 1 }).success).toBe(false);
        expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, [key]: -1 }).success).toBe(false);
      }
    }
    expect(calendarLimitsSchema.safeParse({ ...CALENDAR_LIMITS, modelSpendUsd: '1.01' }).success).toBe(false);
    expect(calendarOptionsSchema.safeParse({ endpoint: 'https://evil.invalid' }).success).toBe(false);
  });
  it('keeps structural, policy, semantic, transport and uncertain outcomes distinct', () => {
    for (const category of ['structural', 'policy', 'clarification', 'provider', 'credential',
      'delivery', 'uncertain', 'persistence', 'budget', 'cancelled'] as const) {
      const value = calendarFailureSchema.parse({ category, code: 'STOPPED', retry: 'none' });
      expect(value.category).toBe(category);
    }
    expect(calendarFailureSchema.safeParse({ category: 'policy', code: 'DENIED', retry: 'schema-repair' }).success).toBe(false);
  });
});
