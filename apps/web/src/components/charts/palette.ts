// Author: Brijesh Dave <https://github.com/brijeshdave>
// The chart palette: a fixed categorical order, and the recessive ink around it.
//
// **Fixed, and deliberately NOT derived from the user's chosen theme.** The app
// ships eight brand palettes; if the series took their hues from whichever one is
// active, the same series would change colour when somebody switched theme, and
// two people looking at the same chart would be describing different pictures.
// Colour here follows the ENTITY — issues are always this blue — which is the one
// rule a categorical palette cannot bend.
//
// Both sets are validated, not eyeballed: run the six checks against the surfaces
// this app actually draws on (light card #ffffff, dark card #111827) —
//
//   node scripts/validate_palette.js "<the light hexes>" --mode light --surface "#ffffff"
//   node scripts/validate_palette.js "<the dark hexes>"  --mode dark  --surface "#111827"
//
// Light passes every check with a contrast WARN on three slots against white,
// which is why every chart here ships either direct labels or the table view —
// that warning is an obligation, not a note.
//
// Dark is a SELECTED set of steps, not an automatic lightening of the light one:
// the same hue at the same lightness reads differently against #111827, and
// flipping mechanically is how dark-mode charts end up muddy.

/** Slot order is fixed. A series takes the next slot and keeps it forever. */
export const SERIES_LIGHT = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
] as const;

export const SERIES_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
] as const;

/**
 * Status colours, reserved. Never reused as "series 7" — a reader who has learned
 * that red means critical should not meet it as an arbitrary category.
 */
export const STATUS = {
  good: { light: "#0ca30c", dark: "#3fbf3f" },
  warning: { light: "#fab219", dark: "#fac83c" },
  critical: { light: "#d03b3b", dark: "#e06565" },
} as const;

/**
 * Is the app currently dark?
 *
 * Read from the DOM rather than a React state because the theme is applied by a
 * pre-hydration script on the root element — the same source the CSS variables
 * use, so a chart can never disagree with the page around it.
 */
export function isDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/** The categorical ramp for the current mode. */
export function seriesColors(dark = isDark()): readonly string[] {
  return dark ? SERIES_DARK : SERIES_LIGHT;
}

/** The colour for one slot, cycling refused: past the ramp, callers fold into "Other". */
export function seriesColor(index: number, dark = isDark()): string {
  const ramp = seriesColors(dark);
  return ramp[Math.min(index, ramp.length - 1)]!;
}

/**
 * Grid, axis and label ink.
 *
 * Text wears TEXT tokens, never a series colour: the coloured mark beside a label
 * is what carries identity, and a label painted in its series' hue competes with
 * the data for the reader's attention while failing contrast on the pale slots.
 */
export const INK = {
  grid: { light: "#e2e8f0", dark: "#1e293b" },
  axis: { light: "#94a3b8", dark: "#64748b" },
  label: { light: "#475569", dark: "#94a3b8" },
  surface: { light: "#ffffff", dark: "#111827" },
} as const;

export function ink(key: keyof typeof INK, dark = isDark()): string {
  return INK[key][dark ? "dark" : "light"];
}

/**
 * Fold a long tail into "Other".
 *
 * The ramp has six slots and a seventh series is never a generated hue. Past the
 * limit the rest becomes one grey remainder, which is also more honest: a bar
 * chart with thirty categories is a table pretending to be a picture.
 */
export function withOther<T extends { label: string; value: number }>(
  points: T[],
  limit = 6,
): { label: string; value: number }[] {
  if (points.length <= limit) return points;
  const head = points.slice(0, limit - 1);
  const rest = points.slice(limit - 1);
  const other = rest.reduce((sum, p) => sum + p.value, 0);
  return [...head, { label: `Other (${rest.length})`, value: other }];
}
