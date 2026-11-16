/**
 * ============================================================================
 * FILE: calendar-policy.spec.ts
 * LOCATION: backend/test/assembly/calendar-policy.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify central Calendar policy deadlines reach existing lifecycle/runtime ports.
 *
 * ROLE IN PROJECT:
 *    Exercises the real assembly factory without external requests or a database.
 *    Distinguishes operator policy configuration from service certification.
 *
 * KEY COMPONENTS:
 *    - Expiry gate: Configured setup stops being usable at its policy deadline.
 *    - Audit bound: Runtime evidence cannot outlive that deadline.
 * ============================================================================
 */
import { expect, it, vi } from 'vitest';
import { createCalendarAssembly } from '../../src/operations/calendar-assembly.js';
import { loadCalendarBootstrap } from '../../src/platform/config/calendar-config.js';
import { assemblyFixture } from './admin-config-fixture.js';

it('bounds setup and runtime evidence by the earliest configured policy deadline', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'));
  const f = assemblyFixture();
  const config = loadCalendarBootstrap({
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret',
    AURVIN_GOOGLE_CALENDAR_REDIRECT_URI:
      'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
    AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID: 'fixture-policy',
    AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED: 'true',
    AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED: 'true',
    AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT: '2026-10-25T10:01:00.000Z',
  }, 'http://127.0.0.1:5173', 3000)!;
  config.policyDeadlines = [...config.policyDeadlines, Date.parse('2026-10-25T10:02:00.000Z')];
  const discovery = { discover: vi.fn() };
  const assembled = createCalendarAssembly({
    config, encryption: f.bootstrap.encryption,
    userId: f.bootstrap.identity.userId,
    store: f.bundle.calendarConnections, storeV2: f.bundle.calendarConnectionsV2,
    discovery, fetcher: f.fetcher, onAccountInvalidated: vi.fn(),
  });
  try {
    expect(assembled.runtime.auditDeadlineAt).toBe('2026-10-25T10:01:00.000Z');
    expect(assembled.connections.isConfigured()).toBe(true);
    vi.setSystemTime(new Date('2026-10-25T10:01:00.000Z'));
    expect(assembled.connections.isConfigured()).toBe(false);
    expect(discovery.discover).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  } finally {
    await assembled.connections.close();
    await assembled.execution.close();
    vi.useRealTimers();
  }
});
