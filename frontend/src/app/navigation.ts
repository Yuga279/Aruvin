/**
 * ============================================================================
 * FILE: navigation.ts
 * LOCATION: frontend/src/app/navigation.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Declarative primary navigation model shared by sidebar and palette.
 *
 * ROLE IN PROJECT:
 *    Lists every planned workspace area once. Items whose feature flag is
 *    off are filtered out, so only destinations backed by working code are
 *    rendered. There is no URL router; destinations map to shell callbacks.
 *
 * KEY COMPONENTS:
 *    - NAV_ITEMS: full planned list with flag and destination
 *    - visibleNavItems: flag-aware filter
 *    - shellNavItems: visible items bound to the shell's handlers
 * ============================================================================
 */

import type { AuthUser } from '../api/auth-protocol.ts';
import { FEATURE_FLAGS, type FeatureFlag } from './feature-flags.ts';

/** Destinations the current shell can actually open. */
export type NavDestination = 'integrations' | 'settings' | 'unavailable';

export type NavItem = {
  id: string;
  label: string;
  /** Absent = always available. */
  flag?: FeatureFlag;
  destination: NavDestination;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: 'Home', flag: 'home', destination: 'unavailable' },
  { id: 'projects', label: 'Projects', flag: 'projects', destination: 'unavailable' },
  { id: 'agents', label: 'Agents', flag: 'agents', destination: 'unavailable' },
  { id: 'memory', label: 'Memory', flag: 'memory', destination: 'unavailable' },
  { id: 'workspace', label: 'Workspace', flag: 'workspace', destination: 'unavailable' },
  { id: 'automations', label: 'Automations', flag: 'automations', destination: 'unavailable' },
  { id: 'integrations', label: 'Integrations', destination: 'integrations' },
  { id: 'settings', label: 'Settings', destination: 'settings' },
];

export function visibleNavItems(
  flags: Readonly<Record<FeatureFlag, boolean>> = FEATURE_FLAGS,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] {
  // An enabled flag without a real destination is still hidden: never link to a placeholder.
  return items.filter((item) => (item.flag === undefined || flags[item.flag]) && item.destination !== 'unavailable');
}

/** Visible items bound to a wired handler (sidebar and command palette).
 * Members ('user' role) only see Plugins in Manage Aurvin, so Settings would
 * duplicate Integrations for them. */
export function shellNavItems(
  handlers: { onManageAurvin?: () => void; onOpenIntegrations?: () => void },
  role: AuthUser['role'] | undefined,
): Array<NavItem & { onSelect: () => void }> {
  const byDestination = { integrations: handlers.onOpenIntegrations, settings: handlers.onManageAurvin };
  return visibleNavItems().flatMap((item) => {
    if (item.destination === 'settings' && role === 'user') return [];
    const onSelect = item.destination === 'unavailable' ? undefined : byDestination[item.destination];
    return onSelect ? [{ ...item, onSelect }] : [];
  });
}
