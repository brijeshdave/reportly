// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reads the real tokens.css and checks every text colour against the surface it
// sits on. Colours are easy to lighten by eye and hard to notice going wrong:
// `text-primary` on the citrus palette was once 2.15:1, effectively invisible.
// WCAG AA wants 4.5:1 for normal text.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { THEME_PALETTES } from "@reportly/shared";
import { describe, expect, it } from "vitest";

// Comments are stripped first: otherwise a comment preceding a block is captured
// as part of that block's selector and nothing matches.
const TOKENS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const AA_NORMAL_TEXT = 4.5;

/* --------------------------- colour maths (sRGB) --------------------------- */

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/* ------------------------------- CSS reading ------------------------------- */

/** Every `--var: value` declared under `selector`, later blocks winning. */
function declarationsFor(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  // Selectors may be comma-separated lists, e.g. `.dark [data-theme="x"], .dark[data-theme="x"]`.
  const blocks = TOKENS.matchAll(/([^{}]+)\{([^}]*)\}/g);

  for (const [, selectors, body] of blocks) {
    const list = (selectors ?? "").split(",").map((s) => s.trim());
    if (!list.includes(selector)) continue;
    for (const [, name, value] of (body ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found[name!.trim()] = value!.trim();
    }
  }
  return found;
}

/** Resolve a token for one mode + palette, honouring `var(--other)` indirection. */
function token(name: string, mode: "light" | "dark", palette: string): string {
  const layers =
    mode === "light"
      ? [declarationsFor(":root"), declarationsFor(`[data-theme="${palette}"]`)]
      : [
          declarationsFor(":root"),
          declarationsFor(`[data-theme="${palette}"]`),
          declarationsFor(".dark"),
          declarationsFor(`.dark[data-theme="${palette}"]`),
        ];

  const resolve1 = (key: string, depth = 0): string => {
    if (depth > 5) throw new Error(`cyclic token: ${key}`);
    let value: string | undefined;
    for (const layer of layers) if (layer[key] !== undefined) value = layer[key];
    if (value === undefined) throw new Error(`missing token ${key} (${mode}/${palette})`);

    const indirect = /^var\((--[\w-]+)\)$/.exec(value);
    return indirect ? resolve1(indirect[1]!, depth + 1) : value;
  };

  return resolve1(name);
}

/* --------------------------------- checks ---------------------------------- */

/** Text tokens, and the surfaces they are rendered on. */
const TEXT_TOKENS = [
  "--foreground",
  "--muted-foreground",
  "--primary",
  "--success",
  "--warning",
  "--destructive",
];
const SURFACES = ["--card", "--background"];

describe.each(["light", "dark"] as const)("%s mode", (mode) => {
  it.each([...THEME_PALETTES])("palette %s reads at AA on every surface", (palette) => {
    const failures: string[] = [];

    for (const text of TEXT_TOKENS) {
      for (const surface of SURFACES) {
        const ratio = contrast(token(text, mode, palette), token(surface, mode, palette));
        if (ratio < AA_NORMAL_TEXT) {
          failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

describe("the brand stops", () => {
  it("stay distinct from the text colour they are no longer tied to", () => {
    // --primary was once `var(--brand-from)`, which is why text-primary inherited a
    // gradient stop and citrus links read at 2.15:1. They are separate tokens now.
    for (const palette of THEME_PALETTES) {
      expect(token("--primary", "light", palette)).not.toBe(token("--brand-to", "light", palette));
    }
  });

  // NOTE: white on the bright stops (ocean, forest, sunset, ember) measures
  // 2.5–2.8:1. That is the primary button, not body text, and darkening those
  // stops changes the brand. Left as a deliberate decision, not an oversight.
});
