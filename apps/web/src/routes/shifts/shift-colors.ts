// Author: Brijesh Dave <https://github.com/brijeshdave>
// The shift palette as concrete Tailwind classes. Kept as full literal strings (never
// interpolated) so the classes survive the build's purge.
//
// Twelve hues, each in a light and a dark shade, because the two are for different
// jobs. **Light is the default and the common case**: a month of ordinary shifts
// should be quiet enough to read for an hour, and pale cells with dark text are what
// that looks like. Dark is for what must be found at a glance — leave, a holiday, the
// one shift somebody is scanning for — where the eye is supposed to land on it.
//
// Getting that the wrong way round is a mistake this file has already made: every
// cell went dark at once, which turned a calendar into a wall of colour where nothing
// stood out because everything did.
//
// **The foreground is chosen per hue, not fixed.** White on amber fails contrast
// badly, so amber's dark shade takes near-black text instead. A rule that said "white
// on dark, always" would have shipped exactly that and called it readable.
//
// The retired names at the end are values that may sit in a database from an earlier
// build. They still render — a stored colour that fails to parse is a screen that
// will not load — but `SHIFT_COLOR_LABELS` marks them and the picker does not offer
// them.
import type { ShiftColor } from "@reportly/shared";

interface ColorClasses {
  /** Fills a calendar cell, with a foreground that reads on it. */
  cell: string;
  /** The same pairing for a colour shown inside running text. */
  chip: string;
  /** The solid dot in the colour picker. */
  swatch: string;
}

export const SHIFT_COLOR_CLASSES: Record<ShiftColor, ColorClasses> = {
  slate: {
    cell: "bg-slate-100 text-slate-900 dark:bg-slate-500/25 dark:text-slate-100",
    chip: "bg-slate-100 text-slate-900 dark:bg-slate-500/25 dark:text-slate-100",
    swatch: "bg-slate-200",
  },
  red: {
    cell: "bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-100",
    chip: "bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-100",
    swatch: "bg-red-200",
  },
  orange: {
    cell: "bg-orange-100 text-orange-900 dark:bg-orange-500/25 dark:text-orange-100",
    chip: "bg-orange-100 text-orange-900 dark:bg-orange-500/25 dark:text-orange-100",
    swatch: "bg-orange-200",
  },
  amber: {
    cell: "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100",
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100",
    swatch: "bg-amber-200",
  },
  green: {
    cell: "bg-green-100 text-green-900 dark:bg-green-500/25 dark:text-green-100",
    chip: "bg-green-100 text-green-900 dark:bg-green-500/25 dark:text-green-100",
    swatch: "bg-green-200",
  },
  teal: {
    cell: "bg-teal-100 text-teal-900 dark:bg-teal-500/25 dark:text-teal-100",
    chip: "bg-teal-100 text-teal-900 dark:bg-teal-500/25 dark:text-teal-100",
    swatch: "bg-teal-200",
  },
  blue: {
    cell: "bg-blue-100 text-blue-900 dark:bg-blue-500/25 dark:text-blue-100",
    chip: "bg-blue-100 text-blue-900 dark:bg-blue-500/25 dark:text-blue-100",
    swatch: "bg-blue-200",
  },
  indigo: {
    cell: "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/25 dark:text-indigo-100",
    chip: "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/25 dark:text-indigo-100",
    swatch: "bg-indigo-200",
  },
  violet: {
    cell: "bg-violet-100 text-violet-900 dark:bg-violet-500/25 dark:text-violet-100",
    chip: "bg-violet-100 text-violet-900 dark:bg-violet-500/25 dark:text-violet-100",
    swatch: "bg-violet-200",
  },
  pink: {
    cell: "bg-pink-100 text-pink-900 dark:bg-pink-500/25 dark:text-pink-100",
    chip: "bg-pink-100 text-pink-900 dark:bg-pink-500/25 dark:text-pink-100",
    swatch: "bg-pink-200",
  },
  cyan: {
    cell: "bg-cyan-100 text-cyan-900 dark:bg-cyan-500/25 dark:text-cyan-100",
    chip: "bg-cyan-100 text-cyan-900 dark:bg-cyan-500/25 dark:text-cyan-100",
    swatch: "bg-cyan-200",
  },
  purple: {
    cell: "bg-purple-100 text-purple-900 dark:bg-purple-500/25 dark:text-purple-100",
    chip: "bg-purple-100 text-purple-900 dark:bg-purple-500/25 dark:text-purple-100",
    swatch: "bg-purple-200",
  },
  "slate-dark": {
    cell: "bg-slate-700 text-white",
    chip: "bg-slate-700 text-white",
    swatch: "bg-slate-700",
  },
  "red-dark": {
    cell: "bg-red-700 text-white",
    chip: "bg-red-700 text-white",
    swatch: "bg-red-700",
  },
  "orange-dark": {
    cell: "bg-orange-700 text-white",
    chip: "bg-orange-700 text-white",
    swatch: "bg-orange-700",
  },
  "amber-dark": {
    cell: "bg-amber-400 text-amber-950",
    chip: "bg-amber-400 text-amber-950",
    swatch: "bg-amber-400",
  },
  "green-dark": {
    cell: "bg-green-700 text-white",
    chip: "bg-green-700 text-white",
    swatch: "bg-green-700",
  },
  "teal-dark": {
    cell: "bg-teal-700 text-white",
    chip: "bg-teal-700 text-white",
    swatch: "bg-teal-700",
  },
  "blue-dark": {
    cell: "bg-blue-700 text-white",
    chip: "bg-blue-700 text-white",
    swatch: "bg-blue-700",
  },
  "indigo-dark": {
    cell: "bg-indigo-700 text-white",
    chip: "bg-indigo-700 text-white",
    swatch: "bg-indigo-700",
  },
  "violet-dark": {
    cell: "bg-violet-700 text-white",
    chip: "bg-violet-700 text-white",
    swatch: "bg-violet-700",
  },
  "pink-dark": {
    cell: "bg-pink-700 text-white",
    chip: "bg-pink-700 text-white",
    swatch: "bg-pink-700",
  },
  "cyan-dark": {
    cell: "bg-cyan-700 text-white",
    chip: "bg-cyan-700 text-white",
    swatch: "bg-cyan-700",
  },
  "purple-dark": {
    cell: "bg-purple-700 text-white",
    chip: "bg-purple-700 text-white",
    swatch: "bg-purple-700",
  },
  "dark-red": {
    cell: "bg-red-900 text-white",
    chip: "bg-red-900 text-white",
    swatch: "bg-red-900",
  },
  maroon: {
    cell: "bg-rose-900 text-white",
    chip: "bg-rose-900 text-white",
    swatch: "bg-rose-900",
  },
  brown: {
    cell: "bg-yellow-900 text-white",
    chip: "bg-yellow-900 text-white",
    swatch: "bg-yellow-900",
  },
  olive: {
    cell: "bg-lime-800 text-white",
    chip: "bg-lime-800 text-white",
    swatch: "bg-lime-800",
  },
  emerald: {
    cell: "bg-emerald-800 text-white",
    chip: "bg-emerald-800 text-white",
    swatch: "bg-emerald-800",
  },
  gray: {
    cell: "bg-gray-700 text-white",
    chip: "bg-gray-700 text-white",
    swatch: "bg-gray-700",
  },
};

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
  cyan: "Cyan",
  purple: "Purple",
  "slate-dark": "Slate (dark)",
  "red-dark": "Red (dark)",
  "orange-dark": "Orange (dark)",
  "amber-dark": "Amber (dark)",
  "green-dark": "Green (dark)",
  "teal-dark": "Teal (dark)",
  "blue-dark": "Blue (dark)",
  "indigo-dark": "Indigo (dark)",
  "violet-dark": "Violet (dark)",
  "pink-dark": "Pink (dark)",
  "cyan-dark": "Cyan (dark)",
  "purple-dark": "Purple (dark)",
  "dark-red": "Dark red (retired)",
  maroon: "Maroon (retired)",
  brown: "Brown (retired)",
  olive: "Olive (retired)",
  emerald: "Emerald (retired)",
  gray: "Gray (retired)",
};

/** The colour of a shift cell, and of the three non-working states. */
export const cellClasses = (color: ShiftColor): string => SHIFT_COLOR_CLASSES[color].cell;
