/**
 * ============================================================================
 * FILE: navigation.test.ts
 * LOCATION: frontend/src/app/navigation.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify flag-aware navigation never exposes unfinished areas.
 *
 * ROLE IN PROJECT:
 *    Release 0 acceptance: only working destinations are rendered, and an
 *    enabled flag without a destination still stays hidden.
 *
 * KEY COMPONENTS:
 *    - Default flags, flag on without destination, flag on with destination
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS } from './feature-flags.ts';
import { NAV_ITEMS, visibleNavItems } from './navigation.ts';

describe('primary navigation', () => {
  it('shows only Integrations and Settings with Release 0 flags', () => {
    expect(visibleNavItems().map((item) => item.id)).toEqual(['integrations', 'settings']);
  });

  it('keeps every flag off in Release 0', () => {
    expect(Object.values(FEATURE_FLAGS).every((on) => on === false)).toBe(true);
  });

  it('hides a flagged area whose destination is not built, even when its flag is on', () => {
    const allOn = Object.fromEntries(Object.keys(FEATURE_FLAGS).map((k) => [k, true])) as Record<keyof typeof FEATURE_FLAGS, boolean>;
    expect(visibleNavItems(allOn).map((item) => item.id)).toEqual(['integrations', 'settings']);
  });

  it('shows a flagged area once it has a destination and its flag is on', () => {
    const items = NAV_ITEMS.map((item) => (item.id === 'projects' ? { ...item, destination: 'settings' as const } : item));
    const flags = { ...FEATURE_FLAGS, projects: true };
    expect(visibleNavItems(flags, items).map((item) => item.id)).toContain('projects');
    expect(visibleNavItems(FEATURE_FLAGS, items).map((item) => item.id)).not.toContain('projects');
  });
});
