import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeCtx = createContext({ theme: 'dark', toggle: () => {}, setTheme: () => {} });
const STORAGE_KEY = 'asgard_v2_theme';

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === 'light' || v === 'dark') return v;
    } catch { /* noop */ }
    // фолбэк на тему оригинала
    try {
      const v = localStorage.getItem('asgard_theme');
      if (v === 'light' || v === 'dark') return v;
    } catch { /* noop */ }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* noop */ }
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t === 'light' ? 'light' : 'dark'), []);
  const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return <ThemeCtx.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
