/**
 * ============================================================================
 * FILE: theme.ts
 * LOCATION: frontend/src/app/theme/theme.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Pure theme preference logic: parse, resolve, persist and apply.
 *
 * ROLE IN PROJECT:
 *    Shared by main.tsx (applied before first render, so there is no
 *    wrong-theme flash after load) and ThemeProvider (runtime switching).
 *    Kept DOM-optional so it is unit-testable in the Node test environment.
 *
 * KEY COMPONENTS:
 *    - parseThemePreference / resolveTheme: closed-enum parsing, dark default
 *    - readThemePreference / writeThemePreference: guarded localStorage
 *    - applyTheme: sets data-theme on <html>
 * ============================================================================
 */

export const THEME_PREFERENCES = ['dark', 'light', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'aurvin:theme';
/** Dark is the product default when nothing (or garbage) is stored. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark';
  return preference;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // Storage can throw in private modes or with blocked site data.
  }
}

export function readThemePreference(storage: StorageLike | null = defaultStorage()): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function writeThemePreference(
  preference: ThemePreference,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Non-persistent is acceptable: the theme still applies for this page.
  }
}

export const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)';

export function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(LIGHT_SCHEME_QUERY).matches
    : false;
}

export function applyTheme(theme: ResolvedTheme, root: HTMLElement | null = globalThis.document?.documentElement ?? null) {
  root?.setAttribute('data-theme', theme);
}
