// Author: Brijesh Dave <https://github.com/brijeshdave>
// The fixed shift palette as concrete Tailwind classes. Kept as full literal strings
// (never interpolated) so the classes survive the build's purge, and theme-aware so a
// chip reads on both light and dark backgrounds. `chip` colours a calendar cell;
// `swatch` is the solid dot the editor's colour picker shows.
import type { ShiftColor } from "@reportly/shared";

export const SHIFT_COLOR_CLASSES: Record<ShiftColor, { chip: string; swatch: string }> = {
  slate: {
    chip: "bg-slate-200 text-slate-800 dark:bg-slate-600/40 dark:text-slate-100",
    swatch: "bg-slate-500",
  },
  red: {
    chip: "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-200",
    swatch: "bg-red-500",
  },
  orange: {
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-500/25 dark:text-orange-200",
    swatch: "bg-orange-500",
  },
  amber: {
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200",
    swatch: "bg-amber-500",
  },
  green: {
    chip: "bg-green-100 text-green-800 dark:bg-green-500/25 dark:text-green-200",
    swatch: "bg-green-500",
  },
  teal: {
    chip: "bg-teal-100 text-teal-800 dark:bg-teal-500/25 dark:text-teal-200",
    swatch: "bg-teal-500",
  },
  blue: {
    chip: "bg-blue-100 text-blue-800 dark:bg-blue-500/25 dark:text-blue-200",
    swatch: "bg-blue-500",
  },
  indigo: {
    chip: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/25 dark:text-indigo-200",
    swatch: "bg-indigo-500",
  },
  violet: {
    chip: "bg-violet-100 text-violet-800 dark:bg-violet-500/25 dark:text-violet-200",
    swatch: "bg-violet-500",
  },
  pink: {
    chip: "bg-pink-100 text-pink-800 dark:bg-pink-500/25 dark:text-pink-200",
    swatch: "bg-pink-500",
  },
};

/** Neutral chips for the non-working states, so W/O, L and PH read as "not a shift". */
export const STATE_CHIP: Record<"off" | "leave" | "holiday", string> = {
  off: "bg-muted text-muted-foreground",
  leave: "bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200",
  holiday: "bg-sky-100 text-sky-800 dark:bg-sky-500/25 dark:text-sky-200",
};
