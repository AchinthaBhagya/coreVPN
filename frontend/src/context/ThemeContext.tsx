import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Stored preference when the visitor has not chosen yet. */
  defaultTheme?: Theme;
}

interface ThemeContextType {
  /** The visitor's preference: may be 'system'. */
  theme: Theme;
  /** The theme actually applied to the document ('light' | 'dark'). */
  resolvedTheme: ResolvedTheme;
  /** The OS-level preference, regardless of the stored setting. */
  systemTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Cycles light -> dark -> system. */
  toggleTheme: () => void;
}

const STORAGE_KEY = 'theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readStoredTheme(fallback: Theme): Theme {
  if (typeof window === 'undefined') return fallback;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : fallback;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

/**
 * Applies the resolved theme to <html>. Keeping a single `.dark` class (light
 * is the un-classed default in `:root`) avoids clobbering any other classes and
 * lets Tailwind's `dark:` variant follow the same switch.
 */
function applyTheme(resolved: ResolvedTheme) {
  const root = window.document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children, defaultTheme = 'light' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(defaultTheme));
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  // Track OS preference changes so 'system' reacts live.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(MEDIA_QUERY);
    const onChange = () => setSystemTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode); the in-memory value still applies */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const resolved = current === 'system' ? getSystemTheme() : current;
      const next: Theme = resolved === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextType>(
    () => ({ theme, resolvedTheme, systemTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, systemTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
