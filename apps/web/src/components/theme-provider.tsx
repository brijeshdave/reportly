// Author: Brijesh Dave <https://github.com/brijeshdave>
// Theme context. Applies the stored theme immediately (the pre-hydration script in
// index.html already did it, so there is no flash), then reconciles with the
// server: the org default plus the user's own override. Changes persist locally at
// once and to the user's settings when they are signed in.
import type { ThemeMode, ThemePalette, ThemeSettings } from "@reportly/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_THEME,
  applyTheme,
  isDarkMode,
  prefersDarkScheme,
  readStoredTheme,
  storeTheme,
} from "@/lib/theme.js";
import { preferencesQuery, queryKeys } from "@/lib/queries.js";
import { type MyPreferences, saveMyTheme } from "@/services/settings.js";

interface ThemeContextValue {
  theme: ThemeSettings;
  isDark: boolean;
  setPalette: (palette: ThemePalette) => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeSettings>(() =>
    typeof window === "undefined" ? DEFAULT_THEME : readStoredTheme(window.localStorage),
  );
  const [prefersDark, setPrefersDark] = useState(prefersDarkScheme);

  // Follow the OS while the mode is "system".
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyTheme(theme, document.documentElement, prefersDark);
  }, [theme, prefersDark]);

  // Reconcile with the server through the shared preferences query, rather than a
  // one-shot fetch. That query is invalidated whenever a preference is written —
  // including an admin changing the org default in Settings — so the theme now
  // re-applies live instead of only after a reload. A signed-out visitor errors
  // here (401) and simply keeps the local theme.
  const queryClient = useQueryClient();
  const { data: preferences } = useQuery(preferencesQuery);
  const serverTheme = preferences?.theme;

  useEffect(() => {
    if (!serverTheme) return;
    setTheme(serverTheme);
    storeTheme(serverTheme, window.localStorage);
  }, [serverTheme?.palette, serverTheme?.mode]);

  const update = useCallback(
    (next: ThemeSettings) => {
      setTheme(next);
      storeTheme(next, window.localStorage);
      // Keep the query cache in step so the reconcile above sees the same value
      // and does not fight the optimistic change.
      queryClient.setQueryData<MyPreferences>(queryKeys.preferences, (current) =>
        current ? { ...current, theme: next } : current,
      );
      // Best-effort: signed-out users keep the change locally.
      void saveMyTheme(next).catch(() => undefined);
    },
    [queryClient],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      isDark: isDarkMode(theme, prefersDark),
      setPalette: (palette) => update({ ...theme, palette }),
      setMode: (mode) => update({ ...theme, mode }),
    }),
    [theme, prefersDark, update],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside a ThemeProvider");
  return context;
}
