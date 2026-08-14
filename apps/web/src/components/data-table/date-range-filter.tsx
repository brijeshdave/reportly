// Author: Brijesh Dave <https://github.com/brijeshdave>
// The date-range control the filter sidebar shows for a `daterange` field. A row
// of suggested periods for the common case, and two date inputs for a custom span.
// It emits one `between` filter carrying `[fromISO, toISO]`; an empty bound is an
// open end, so "custom" with only a start means "since then".
import type { Filter } from "@reportly/shared";
import { useState } from "react";

import { Button } from "@/components/ui/primitives.js";
import {
  DATE_RANGE_PRESETS,
  dayEndIso,
  dayStartIso,
  isoToDay,
  type DateRangeValue,
} from "@/lib/date-ranges.js";

function currentRange(filter: Filter | undefined): DateRangeValue {
  const value = filter?.value;
  if (Array.isArray(value) && value.length === 2) {
    return [String(value[0] ?? ""), String(value[1] ?? "")];
  }
  return ["", ""];
}

export function DateRangeFilter({
  field,
  current,
  onChange,
  onClear,
}: {
  field: string;
  current: Filter | undefined;
  onChange: (filter: Filter) => void;
  onClear: () => void;
}) {
  const [from, to] = currentRange(current);
  // Which preset chip is highlighted. Cleared once the custom inputs are touched.
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const emit = (range: DateRangeValue) => {
    // Both bounds empty is no range at all — drop the filter rather than leaving a
    // match-everything one behind.
    if (!range[0] && !range[1]) onClear();
    else onChange({ field, op: "between", value: range });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {DATE_RANGE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant={activePreset === preset.id ? "primary" : "secondary"}
            onClick={() => {
              setActivePreset(preset.id);
              emit(preset.range(new Date()));
            }}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input
            type="date"
            value={isoToDay(from)}
            onChange={(event) => {
              setActivePreset(null);
              emit([dayStartIso(event.target.value), to]);
            }}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input
            type="date"
            value={isoToDay(to)}
            onChange={(event) => {
              setActivePreset(null);
              emit([from, dayEndIso(event.target.value)]);
            }}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
    </div>
  );
}
