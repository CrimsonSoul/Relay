import { useState, useEffect, useCallback } from 'react';
import { secureStorage } from '../utils/secureStorage';

export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

function getOsTheme(): ResolvedTheme {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getOsTheme() : preference;
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    return secureStorage.getItemSync<ThemePreference>(STORAGE_KEY, 'system') ?? 'system';
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(preference));

  const setPreference = useCallback((p: ThemePreference) => {
    secureStorage.setItemSync(STORAGE_KEY, p);
    setPreferenceState(p);
  }, []);

  // Apply theme and listen for OS changes
  useEffect(() => {
    let cancelled = false;
    const current = resolve(preference);
    setResolved(current);
    applyTheme(current);

    if (preference !== 'system') return;

    const mql = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent | { matches: boolean }) => {
      if (cancelled) return;
      const next = e.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    mql.addEventListener('change', handler);
    return () => {
      cancelled = true;
      mql.removeEventListener('change', handler);
    };
  }, [preference]);

  return { preference, resolved, setPreference } as const;
}
