/**
 * ============================================================================
 * FILE: calendar-docs.spec.ts
 * LOCATION: backend/test/assembly/calendar-docs.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Check current Calendar setup/runbook contracts and preserve historical evidence.
 *
 * ROLE IN PROJECT:
 *    Validates local documentation links and explicit pending release gates.
 *    Does not execute operator procedures or claim service verification.
 *
 * KEY COMPONENTS:
 *    - Runbook checks: Scopes, limits, ownership gaps, and service gates.
 *    - Setup checks: Backend-only configuration and unchanged staging boundary.
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('publishes a local-only runbook without promising live acceptance', () => {
  const text = readFileSync('../docs/google-calendar-plugin/operations.md', 'utf8');
  for (const required of ['calendar.calendarlist.readonly', 'calendar.events', 'calendar.freebusy',
    'openid', 'email', '2026-07-28', '2.3.1', 'unknown', 'backup', 'rollback', 'G8', 'G9', 'skipped']) {
    expect(text).toContain(required);
  }
  expect(text).not.toMatch(/live checks passed|fully local processing|exactly-once execution/i);
});

it('documents backend-only Calendar setup without enabling staging tools', () => {
  const readme = readFileSync('../README.md', 'utf8');
  const staging = readFileSync('../deployment/staging/README.md', 'utf8');
  expect(readme).toContain('docs/google-calendar-plugin/operations.md');
  expect(readme).toContain('AURVIN_GOOGLE_CALENDAR_CLIENT_ID');
  expect(readme).toContain('127.0.0.1:8001');
  expect(readme).toContain('127.0.0.1:5179');
  expect(staging).toContain('not an admitted Calendar transport');
  expect(staging).not.toMatch(/forward Calendar|enable Calendar on staging/i);
});

it('publishes Phase 2 operations separately from historical and P9 evidence', () => {
  const path = '../docs/google-calendar-multi-calendar/operations.md';
  expect(existsSync(path)).toBe(true);
  const text = readFileSync(path, 'utf8');
  for (const required of ['openid', 'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.freebusy',
    'include_granted_scopes=true', 'prompt=consent', 'Sensitive',
    'defaultSettingRevision', 'connectionRevision', 'writerWithoutPrivateAccess',
    'P8-GATE-P4-CALENDAR-GET', 'P8-GATE-P2-INVALIDATION', 'P8-GATE-MIGRATION-ENTRYPOINT',
    'P8-GATE-P6-REQUEST-ACCOUNTING',
    'MC-LIVE-CONSENT', 'MC-LIVE-ACL', 'MC-NATIVE', 'MC-BROWSER', 'MC-POLICY', 'MC-LIVE-QUOTA',
    'unknown', 'backup', 'rollback', 'retention', 'transparent', 'not a reservation',
    '127.0.0.1:8001', '127.0.0.1:5179', '2.3.1', '2026-07-28',
    '100', '50', '2,000', '256 KiB', '16 KiB', 'skipped, not passed']) {
    expect(text, required).toContain(required);
  }
  expect(text).not.toMatch(/live checks passed|fully local processing|exactly-once execution/iu);
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const target = match[1]!.split('#', 1)[0]!;
    if (target === '' || /^[a-z]+:/iu.test(target)) continue;
    expect(existsSync(resolve(dirname(path), target)), target).toBe(true);
  }
});

it('documents no-target setup and ships only blank optional Calendar values', () => {
  const readme = readFileSync('../README.md', 'utf8');
  const example = readFileSync('.env.example', 'utf8');
  expect(readme).toContain('docs/google-calendar-multi-calendar/operations.md');
  expect(readme).toContain('No target ID is required');
  expect(readme).toContain('deprecated and ignored');
  for (const name of ['CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI', 'PROCESSING_POLICY_ID',
    'POLICY_APPROVED', 'CONTENT_PERMISSION', 'MINIMAL_EVIDENCE_ALLOWED', 'POLICY_DEADLINE_AT', 'TIME_ZONE']) {
    expect(example).toContain(`AURVIN_GOOGLE_CALENDAR_${name}=`);
  }
  const assignments = example.split(/\r?\n/u)
    .filter(line => line.startsWith('AURVIN_GOOGLE_CALENDAR_'));
  expect(assignments.every(line => line.endsWith('='))).toBe(true);
  expect(example).not.toMatch(/^AURVIN_GOOGLE_CALENDAR_TARGET_ID=/mu);
  expect(example).not.toMatch(/VITE_GOOGLE|VITE_CALENDAR/iu);
  expect(readme).toContain('backend/src/operations/local-guard.ps1');
});
