// Author: Brijesh Dave <https://github.com/brijeshdave>
// A segmented control: a few mutually exclusive views of the same screen.
//
// One component because there were three hand-rolled copies — the reports
// library, the shift-change boxes and the points ledger — and two of them marked
// the selected segment with `bg-muted` against a plain background, which is all
// but invisible. Reported as "the active tab looks the same as the others", and
// it did.
//
// Distinct from `PageTabs`: those switch panels within a record and live in the
// URL. This filters what one panel shows, so it is a set of toggle buttons and
// says so with `aria-pressed` rather than pretending to be a tablist.
import type { ReactNode } from "react";

import { cn } from "@/lib/cn.js";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
}

export function SegmentedTabs<T extends string>({
  segments,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for a reader who cannot see it sits above a list. */
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted p-0.5",
        className,
      )}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(segment.value)}
            // Filled with the primary colour rather than merely raised. A
            // "raised" pill relies on `bg-card` sitting above `bg-muted`, and in
            // several of the shipped palettes those two are all but the same
            // near-white — which is how the first attempt at this fix still
            // looked like nothing was selected.
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              selected
                ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
