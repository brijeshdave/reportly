// Author: Brijesh Dave <https://github.com/brijeshdave>
// One row of colour swatches, used by the shift editor and by the calendar's
// day-off / leave / holiday colours.
//
// Shared because the two must offer the same palette: a shift and a leave day sit in
// the same grid, and a picker that offered a colour the other could not produce would
// let somebody build a month with two different reds in it.
//
// The retired names are filtered out here rather than in the palette table — the
// table still has to *render* them, because a shift coloured before they were retired
// is still in somebody's database, and a colour that fails to resolve is a calendar
// that will not draw.
import { LEGACY_SHIFT_COLORS, SHIFT_COLORS, type ShiftColor } from "@reportly/shared";

import { cn } from "@/lib/cn.js";
import { SHIFT_COLOR_CLASSES, SHIFT_COLOR_LABELS } from "@/routes/shifts/shift-colors.js";

const RETIRED = new Set<string>(LEGACY_SHIFT_COLORS);

/** The colours worth offering: everything except the retired names. */
export const OFFERED_COLORS: readonly ShiftColor[] = SHIFT_COLORS.filter(
  (color) => !RETIRED.has(color),
);

export function ColorPicker({
  value,
  onChange,
  disabled,
  label,
}: {
  value: ShiftColor;
  onChange: (color: ShiftColor) => void;
  disabled?: boolean;
  /** Names the row for a screen reader; each swatch names its own colour. */
  label: string;
}) {
  // A colour saved before the name was retired still has to show as selected, or the
  // picker would claim nothing is chosen and quietly change it on the next save.
  const retiredButChosen = RETIRED.has(value) ? [value] : [];

  const swatch = (color: ShiftColor) => (
    <button
      key={color}
      type="button"
      aria-label={SHIFT_COLOR_LABELS[color]}
      title={SHIFT_COLOR_LABELS[color]}
      aria-pressed={value === color}
      disabled={disabled}
      onClick={() => onChange(color)}
      className={cn(
        "h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition",
        SHIFT_COLOR_CLASSES[color].swatch,
        value === color ? "ring-2 ring-foreground" : "hover:scale-110",
      )}
    />
  );

  const light = OFFERED_COLORS.filter((color) => !color.endsWith("-dark"));
  const dark = OFFERED_COLORS.filter((color) => color.endsWith("-dark"));

  // Two clusters with a divider, because twenty-four circles in one run is a wall
  // nobody scans: the choice being made is "quiet or loud?" first and "which hue?"
  // second, and the layout should ask them in that order.
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {retiredButChosen.map(swatch)}
      {light.map(swatch)}
      <span className="mx-1 h-6 w-px bg-border" aria-hidden />
      {dark.map(swatch)}
    </div>
  );
}
