// Author: Brijesh Dave <https://github.com/brijeshdave>
// The shift palette as concrete Tailwind classes. Kept as full literal strings (never
// interpolated) so the classes survive the build's purge.
//
// Three variants, because the same colour is asked to do three jobs:
//
//   `cell`   — fills a whole calendar cell, solid and dark. This is the one that
//              matters: a month is read as a pattern of colour before it is read as
//              letters, and a pale pill inside a white cell gives the eye nothing to
//              catch. Solid also means the same class works in both themes, since the
//              cell is no longer borrowing the page's background.
//   `chip`   — the older pale pill, still used where a colour appears inside running
//              text or a legend line rather than as a block.
//   `swatch` — the solid dot in the colour picker.
//
// **The foreground is chosen per hue, not fixed to white.** White on amber or on
// yellow-green fails contrast badly; a rule that said "white everywhere" would have
// shipped exactly that and called it readable. Each entry below carries the
// foreground that actually passes against its own background, and `FOREGROUND_NOTE`
// records which ones are dark-on-light so the choice is visible rather than folklore.
import type { ShiftColor } from "@reportly/shared";

interface ColorClasses {
  /** Solid fill for a calendar cell, with a foreground that reads on it. */
  cell: string;
  /** Pale pill, for a colour shown inside text. */
  chip: string;
  /** Solid dot for the picker. */
  swatch: string;
}

export const SHIFT_COLOR_CLASSES: Record<ShiftColor, ColorClasses> = {
  slate: {
    cell: "bg-slate-600 text-white",
    chip: "bg-slate-200 text-slate-800 dark:bg-slate-600/40 dark:text-slate-100",
    swatch: "bg-slate-600",
  },
  red: {
    cell: "bg-red-600 text-white",
    chip: "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-200",
    swatch: "bg-red-600",
  },
  orange: {
    cell: "bg-orange-600 text-white",
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-500/25 dark:text-orange-200",
    swatch: "bg-orange-600",
  },
  amber: {
    // Near-black on amber: white on this background is the classic unreadable pair.
    cell: "bg-amber-400 text-amber-950",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200",
    swatch: "bg-amber-400",
  },
  green: {
    cell: "bg-green-700 text-white",
    chip: "bg-green-100 text-green-800 dark:bg-green-500/25 dark:text-green-200",
    swatch: "bg-green-700",
  },
  teal: {
    cell: "bg-teal-700 text-white",
    chip: "bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-200",
    swatch: "bg-teal-700",
  },
  blue: {
    cell: "bg-blue-700 text-white",
    chip: "bg-blue-100 text-blue-800 dark:bg-blue-500/25 dark:text-blue-200",
    swatch: "bg-blue-700",
  },
  indigo: {
    cell: "bg-indigo-700 text-white",
    chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/25 dark:text-indigo-200",
    swatch: "bg-indigo-700",
  },
  violet: {
    cell: "bg-violet-700 text-white",
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-500/25 dark:text-violet-200",
    swatch: "bg-violet-700",
  },
  pink: {
    cell: "bg-pink-600 text-white",
    chip: "bg-pink-100 text-pink-800 dark:bg-pink-500/25 dark:text-pink-200",
    swatch: "bg-pink-600",
  },
  // --- added for the dark grid; the eye must separate these at a glance ---
  "dark-red": {
    cell: "bg-red-900 text-white",
    chip: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-100",
    swatch: "bg-red-900",
  },
  maroon: {
    cell: "bg-rose-900 text-white",
    chip: "bg-rose-200 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100",
    swatch: "bg-rose-900",
  },
  brown: {
    cell: "bg-yellow-900 text-white",
    chip: "bg-yellow-200 text-yellow-900 dark:bg-yellow-900/50 dark:text-yellow-100",
    swatch: "bg-yellow-900",
  },
  olive: {
    cell: "bg-lime-800 text-white",
    chip: "bg-lime-200 text-lime-900 dark:bg-lime-900/50 dark:text-lime-100",
    swatch: "bg-lime-800",
  },
  emerald: {
    cell: "bg-emerald-800 text-white",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/25 dark:text-emerald-100",
    swatch: "bg-emerald-800",
  },
  cyan: {
    cell: "bg-cyan-800 text-white",
    chip: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/25 dark:text-cyan-100",
    swatch: "bg-cyan-800",
  },
  purple: {
    cell: "bg-purple-800 text-white",
    chip: "bg-purple-100 text-purple-800 dark:bg-purple-500/25 dark:text-purple-100",
    swatch: "bg-purple-800",
  },
  gray: {
    cell: "bg-gray-700 text-white",
    chip: "bg-gray-200 text-gray-800 dark:bg-gray-600/40 dark:text-gray-100",
    swatch: "bg-gray-700",
  },
};

/**
 * The entries whose cell text is dark rather than white, and why — so the next person
 * adding a colour copies the reasoning instead of the default.
 */
export const DARK_TEXT_COLORS: readonly ShiftColor[] = ["amber"];

/** What to write beside a colour in the picker, so the choice is not a guess. */
export const SHIFT_COLOR_LABELS: Record<ShiftColor, string> = {
  slate: "Slate",
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  indigo: "Indigo",
  violet: "Violet",
  pink: "Pink",
  "dark-red": "Dark red",
  maroon: "Maroon",
  brown: "Brown",
  olive: "Olive",
  emerald: "Emerald",
  cyan: "Cyan",
  purple: "Purple",
  gray: "Gray",
};

/** The colour of a shift cell, and of the three non-working states. */
export const cellClasses = (color: ShiftColor): string => SHIFT_COLOR_CLASSES[color].cell;
