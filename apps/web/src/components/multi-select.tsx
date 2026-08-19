// Author: Brijesh Dave <https://github.com/brijeshdave>
// A multi-select you can type to search — the sibling of SearchableSelect, for a
// filter that takes several values at once (three locations, two categories). It
// keeps the same portal + flip positioning so it is never clipped by a scrolling
// container, but toggles values without closing, shows how many are picked, and
// offers a one-click clear.
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import type { SelectOption } from "@/components/searchable-select.js";
import { cn } from "@/lib/cn.js";

interface Coords {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

export function MultiSelect({
  id,
  values,
  onChange,
  options,
  placeholder = "Any",
  disabled,
  ariaLabel,
  "aria-describedby": describedBy,
}: {
  /** Put `Field`'s id here, or its `<label for>` points at nothing. */
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  "aria-describedby"?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The row the arrows are on. Unlike the single-select there is no "clear" row to
  // start above, so -1 simply means "nothing aimed at yet".
  const [active, setActive] = useState(-1);
  const [coords, setCoords] = useState<Coords | null>(null);

  const chosen = new Set(values);
  const summary = useMemo(() => {
    if (values.length === 0) return null;
    if (values.length === 1) {
      return options.find((o) => o.value === values[0])?.label ?? "1 selected";
    }
    return `${values.length} selected`;
  }, [values, options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(q) || option.hint?.toLowerCase().includes(q),
    );
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = buttonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const flipUp = below < 220 && above > below;
      setCoords({
        left: rect.left,
        width: rect.width,
        top: flipUp ? undefined : rect.bottom + 4,
        bottom: flipUp ? window.innerHeight - rect.top + 4 : undefined,
        maxHeight: Math.max(160, Math.min(340, flipUp ? above : below)),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const toggle = (value: string) => {
    onChange(chosen.has(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  /**
   * Arrows move, Enter toggles, Escape leaves.
   *
   * Enter deliberately does *not* close: picking several is the whole reason this
   * control exists, and a list that shut after each choice would make choosing
   * three people three round trips.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const last = filtered.length - 1;
      if (last < 0) return;
      setActive((current) => {
        if (event.key === "ArrowDown") return current >= last ? 0 : current + 1;
        return current <= 0 ? last : current - 1;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[active];
      if (option) toggle(option.value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      setActive(-1);
      buttonRef.current?.focus();
    }
  };

  // Keep the active row in view; optional, and absent in jsdom.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector('[data-active="true"]');
    if (row instanceof HTMLElement) row.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <span className={cn("truncate", !summary && "text-muted-foreground")}>
          {summary ?? placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open && coords
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[60]" aria-hidden onClick={close} />
              <div
                role="listbox"
                aria-multiselectable
                style={{
                  position: "fixed",
                  left: coords.left,
                  width: coords.width,
                  top: coords.top,
                  bottom: coords.bottom,
                  maxHeight: coords.maxHeight,
                }}
                className="z-[61] flex flex-col overflow-hidden rounded-xl border border-border bg-card p-1 shadow-lg"
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-1">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActive(-1);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder="Search…"
                    aria-label="Search options"
                    className="h-7 w-full bg-transparent text-sm focus-visible:outline-none"
                  />
                </div>

                <div ref={listRef} className="flex-1 overflow-y-auto pt-1">
                  {values.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => onChange([])}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
                    >
                      Clear all
                    </button>
                  ) : null}

                  {filtered.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      No matches
                    </p>
                  ) : (
                    filtered.map((option, index) => {
                      const isOn = chosen.has(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={isOn}
                          data-active={index === active}
                          onMouseEnter={() => setActive(index)}
                          onClick={() => toggle(option.value)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                            index === active ? "bg-muted" : "",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{option.label}</span>
                            {option.hint ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {option.hint}
                              </span>
                            ) : null}
                          </span>
                          {isOn ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
