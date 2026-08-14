// Author: Brijesh Dave <https://github.com/brijeshdave>
// Theme resolution. Pure helpers so the same logic runs in the pre-hydration
// script, in React, and in tests. The palette drives `data-theme`; the resolved
// mode toggles the `dark` class on <html>.
import { type ThemeSettings, THEME_PALETTES, themeSettingsSchema } from "@reportly/shared";

export const THEME_STORAGE_KEY = "reportly.theme";

export const DEFAULT_THEME: ThemeSettings = { palette: "aurora", mode: "system" };

/** `system` follows the OS; everything else is explicit. */
export function isDarkMode(theme: ThemeSettings, prefersDark: boolean): boolean {
  if (theme.mode === "dark") return true;
  if (theme.mode === "light") return false;
  return prefersDark;
}

export function prefersDarkScheme(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Apply a theme to the document. Safe to call repeatedly. */
export function applyTheme(theme: ThemeSettings, root: HTMLElement, prefersDark: boolean): void {
  root.setAttribute("data-theme", theme.palette);
  root.classList.toggle("dark", isDarkMode(theme, prefersDark));
}

export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): ThemeSettings {
  try {
    const raw = storage?.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = themeSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function storeTheme(
  theme: ThemeSettings,
  storage: Pick<Storage, "setItem"> | undefined,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // storage may be unavailable (private mode) — the theme still applies in-memory
  }
}

/** Human labels for the palette picker. */
export const PALETTE_LABELS: Record<(typeof THEME_PALETTES)[number], string> = {
  aurora: "Aurora",
  ocean: "Ocean",
  forest: "Forest",
  sunset: "Sunset",
  ember: "Ember",
  orchid: "Orchid",
  citrus: "Citrus",
  graphite: "Graphite",
};
