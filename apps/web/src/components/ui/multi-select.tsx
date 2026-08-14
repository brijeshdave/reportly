// Author: Brijesh Dave <https://github.com/brijeshdave>
// Picking several things from a list, without a native `<select multiple>`.
//
// The native control is a trap: it needs ctrl-click to add a second item, it is a
// cramped scrolling box that hides most of its options, and a plain click on it
// silently discards everything already chosen. Choosing two sites should not be a
// skill. This is a plain list of checkboxes behind a button that says what is
// currently picked.
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  /** Shown when nothing is picked — for sites, "nothing" means "all of them". */
  emptyLabel = "None",
  label,
  disabled = false,
  className = "",
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
  /** The accessible name; the visible one is whatever is picked. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  // Dismiss on a click elsewhere or on Escape, the same way the table menus do.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const chosen = options.filter((option) => selected.includes(option.value));

  // Two names read fine; a list of five does not. Past that, say how many.
  const summary =
    chosen.length === 0
      ? emptyLabel
      : chosen.length <= 2
        ? chosen.map((option) => option.label).join(", ")
        : `${chosen.length} of ${options.length}`;

  const toggle = (value: string) => {
    // Toggling one leaves the rest alone — the whole point of not being a native
    // multi-select, where a click without ctrl throws the others away.
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  };

  return (
    <div ref={container} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        title={chosen.length > 2 ? chosen.map((option) => option.label).join(", ") : undefined}
        className="flex h-8 w-full items-center justify-between gap-1 rounded-lg border border-border bg-card px-2 text-xs disabled:opacity-50"
      >
        <span className={`truncate ${chosen.length === 0 ? "text-muted-foreground" : ""}`}>
          {summary}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        // A listbox of options rather than a stack of anonymous buttons: the tick is
        // drawn with an aria-hidden span, so without `aria-selected` the only signal
        // of what is already chosen is the one a screen reader cannot see.
        <div
          role="listbox"
          aria-multiselectable
          aria-label={label}
          className="absolute right-0 z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg"
        >
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Nothing to choose.</p>
          ) : null}

          {options.map((option) => {
            const picked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={picked}
                onClick={() => toggle(option.value)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    picked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                  aria-hidden
                >
                  {picked ? <Check className="h-3 w-3" /> : null}
                </span>
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}

          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full border-t border-border px-2 pt-1.5 pb-1 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              Clear — {emptyLabel.toLowerCase()}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
