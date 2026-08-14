// Author: Brijesh Dave <https://github.com/brijeshdave>
// Theme resolution is pure, so it can be tested without a browser.
import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, applyTheme, isDarkMode, readStoredTheme, storeTheme } from "@/lib/theme.js";

describe("isDarkMode", () => {
  it("honours an explicit mode regardless of the OS", () => {
    expect(isDarkMode({ palette: "aurora", mode: "dark" }, false)).toBe(true);
    expect(isDarkMode({ palette: "aurora", mode: "light" }, true)).toBe(false);
  });

  it("follows the OS when the mode is system", () => {
    expect(isDarkMode({ palette: "ocean", mode: "system" }, true)).toBe(true);
    expect(isDarkMode({ palette: "ocean", mode: "system" }, false)).toBe(false);
  });
});

describe("applyTheme", () => {
  it("sets data-theme and toggles the dark class", () => {
    const root = document.createElement("html");

    applyTheme({ palette: "forest", mode: "dark" }, root, false);
    expect(root.getAttribute("data-theme")).toBe("forest");
    expect(root.classList.contains("dark")).toBe(true);

    applyTheme({ palette: "citrus", mode: "light" }, root, true);
    expect(root.getAttribute("data-theme")).toBe("citrus");
    expect(root.classList.contains("dark")).toBe(false);
  });
});

describe("stored theme", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    };
  }

  it("round-trips a valid theme", () => {
    const storage = memoryStorage();
    storeTheme({ palette: "ember", mode: "light" }, storage);
    expect(readStoredTheme(storage)).toEqual({ palette: "ember", mode: "light" });
  });

  it("falls back to the default for missing or invalid values", () => {
    expect(readStoredTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(readStoredTheme({ getItem: () => "not json" })).toEqual(DEFAULT_THEME);
    expect(readStoredTheme({ getItem: () => '{"palette":"neon","mode":"dark"}' })).toEqual(
      DEFAULT_THEME,
    );
  });
});
