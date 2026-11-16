/**
 * ============================================================================
 * FILE: theme.test.ts
 * LOCATION: frontend/src/app/theme/theme.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify theme preference parsing, resolution, persistence and apply.
 *
 * ROLE IN PROJECT:
 *    Guards the dark default, the closed preference enum, storage failure
 *    tolerance and the data-theme contract that tokens.css depends on.
 *
 * KEY COMPONENTS:
 *    - parse/resolve cases, storage round trip and throwing storage
 * ============================================================================
 */

import { describe, expect, it } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from './theme.ts';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map };
}

describe('theme preference', () => {
  it('defaults to dark for missing or unknown values', () => {
    expect(parseThemePreference(null)).toBe('dark');
    expect(parseThemePreference('purple')).toBe('dark');
    expect(parseThemePreference(42)).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('resolves system against the OS preference only', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('round-trips through storage under the aurvin key', () => {
    const storage = memoryStorage();
    expect(readThemePreference(storage)).toBe('dark');
    writeThemePreference('light', storage);
    expect(storage.map.get(THEME_STORAGE_KEY)).toBe('light');
    expect(readThemePreference(storage)).toBe('light');
  });

  it('tolerates storage that throws', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readThemePreference(broken)).toBe('dark');
    expect(() => writeThemePreference('light', broken)).not.toThrow();
  });

  it('applies the resolved theme as data-theme on the root element', () => {
    const attrs: Record<string, string> = {};
    const root = { setAttribute: (k: string, v: string) => { attrs[k] = v; } } as unknown as HTMLElement;
    applyTheme('light', root);
    expect(attrs['data-theme']).toBe('light');
  });
});
