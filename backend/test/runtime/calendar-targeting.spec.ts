/**
 * ============================================================================
 * FILE: calendar-targeting.spec.ts
 * LOCATION: backend/test/runtime/calendar-targeting.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Integration tests for target calendar resolution precedence, capability checks, and clarifications.
 *
 * ROLE IN PROJECT:
 *    Ensures explicit user calendar targets take precedence over saved defaults and primary,
 *    and prevents silent fallbacks to primary when explicit targets are unknown, ambiguous, or missing.
 *
 * KEY COMPONENTS:
 *    - runCreate: Test helper executing a natural language scheduling turn.
 *    - Targeting precedence and capability enforcement tests.
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import type { CalendarCreateInput } from '../../src/contracts/calendar-tools.js';
import { calendarFixture, createWire, loadWire, textWire, type CalendarRuntimeFixture }
  from './calendar-runtime.fixture.js';
import { event } from './calendar-multi-fixture.js';

async function runCreate(h: CalendarRuntimeFixture, content: string, action: CalendarCreateInput) {
  const ids = await h.submit(content);
  h.modelWires.push(loadWire('calendar_create_event'), createWire(action, 'create-one'), textWire('Created.'));
  await h.execute(ids);
  return ids;
}

describe('calendar-targeting', () => {
  it('uses explicit target before saved default and primary', async () => {
    const h = calendarFixture();
    try {
      await h.setDefault('personal@example.test');
      const ids = await runCreate(
        h,
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.',
        event(),
      );
      expect(await h.operationFor(ids)).toMatchObject({
        calendarId: 'team@example.test',
        action: { calendarId: 'team@example.test' },
      });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it('does not replace an unknown explicit target or a lost default with primary', async () => {
    const h = calendarFixture();
    try {
      const ids = await h.submit(
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Missing calendar.',
      );
      h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'));
      await h.execute(ids);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect(await h.operationFor(ids)).toBeNull();
      expect(h.frames.some(frame => frame.event.type === 'calendar-clarification')).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it('uses saved default when user omits explicit selector', async () => {
    const h = calendarFixture();
    try {
      await h.setDefault('team@example.test');
      const ids = await runCreate(
        h,
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
        event(),
      );
      expect(await h.operationFor(ids)).toMatchObject({
        calendarId: 'team@example.test',
      });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it('uses primary when no explicit target and no default configured', async () => {
    const h = calendarFixture();
    try {
      const ids = await runCreate(
        h,
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
        event(),
      );
      expect(await h.operationFor(ids)).toMatchObject({
        calendarId: 'personal@example.test',
      });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it('clarifies with candidates when multiple calendars share the same label', async () => {
    const h = calendarFixture();
    try {
      await h.setDiscovery({ duplicateWorkNames: true });
      const ids = await h.submit(
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.',
      );
      h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'));
      await h.execute(ids);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect(await h.operationFor(ids)).toBeNull();
      const frame = h.frames.find(f => f.event.type === 'calendar-clarification');
      expect(frame).toBeDefined();
      expect((frame!.event as any).candidates).toHaveLength(2);
    } finally {
      await h.dispose();
    }
  });

  it('denies scheduling on a read-only calendar without calling create', async () => {
    const h = calendarFixture();
    try {
      await h.setRole('team@example.test', 'reader');
      const ids = await h.submit(
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my Work calendar.',
      );
      h.modelWires.push(loadWire('calendar_create_event'), createWire(event(), 'create-one'));
      await h.execute(ids);
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(0);
      expect(await h.operationFor(ids)).toBeNull();
    } finally {
      await h.dispose();
    }
  });

  it('clears default and falls back to primary', async () => {
    const h = calendarFixture();
    try {
      await h.setDefault('team@example.test');
      await h.setDefault(null);
      const ids = await runCreate(
        h,
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC.',
        event(),
      );
      expect(await h.operationFor(ids)).toMatchObject({
        calendarId: 'personal@example.test',
      });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it('normalizes case and spacing for explicit calendar selection', async () => {
    const h = calendarFixture();
    try {
      const ids = await runCreate(
        h,
        'Schedule Planning on 2026-11-03 from 10:00 to 11:00 Etc/UTC in my   work   calendar.',
        event(),
      );
      expect(await h.operationFor(ids)).toMatchObject({
        calendarId: 'team@example.test',
      });
      expect(h.effects.filter(e => e.kind === 'create')).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});
