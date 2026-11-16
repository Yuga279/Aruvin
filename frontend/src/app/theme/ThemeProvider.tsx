/**
 * ============================================================================
 * FILE: ThemeProvider.tsx
 * LOCATION: frontend/src/app/theme/ThemeProvider.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    React context for the System / Dark / Light theme preference.
 *
 * ROLE IN PROJECT:
 *    Mounted at the top of App so the profile menu and command palette can
 *    switch themes. Persists the choice per browser and follows the OS
 *    setting live while the preference is "system".
 *
 * KEY COMPONENTS:
 *    - ThemeProvider: owns preference state and applies data-theme
 *    - useTheme: { preference, resolved, setPreference }
 * ============================================================================
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LIGHT_SCHEME_QUERY,
  applyTheme,
  readThemePreference,
  resolveTheme,
  systemPrefersLight,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme.ts';

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, initialPreference }: { children: ReactNode; initialPreference?: ThemePreference }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => initialPreference ?? readThemePreference());
  const [prefersLight, setPrefersLight] = useState(() => systemPrefersLight());
  const resolved = resolveTheme(preference, prefersLight);

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    if (preference !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia(LIGHT_SCHEME_QUERY);
    const onChange = () => setPrefersLight(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Returns null outside a provider so isolated component tests keep working. */
export function useTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
