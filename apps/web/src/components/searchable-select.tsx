// Author: Brijesh Dave <https://github.com/brijeshdave>
// A single-select dropdown you can type to search — for a field with more options
// than a native <select> is comfortable to scan (people, departments, tags). One
// value at a time; an empty value clears it.
//
// The popover is rendered in a portal with fixed positioning, not as an absolute
// child, so a scrollable, clipping container (the filter sidebar) cannot cut it off.
// It flips above the field when there is not enough room below, and sizes itself to
// the space available so the options are always readable and reachable.
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn.js";
import { useAnchoredPopover } from "@/lib/use-anchored-popover.js";

export interface SelectOption {
  value: string;
  label: string;
  /** A second line to tell same-named options apart (a person's department, say). */
  hint?: string;
}

export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Any",
  disabled,
  ariaLabel,
  "aria-describedby": describedBy,
}: {
  /** Put `Field`'s id here, or its `<label for>` points at nothing. */
  id?: string;
  value: string;
  onChange: (value: string) => void;
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
  // Which option the arrow keys are on. -1 is the "clear" row at the top, which is
  // a real choice here rather than a decoration.
  const [active, setActive] = useState(-1);
  const coords = useAnchoredPopover(open, buttonRef);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) => option.label.toLowerCase().includes(q) || option.hint?.toLowerCase().includes(q),
    );
  }, [options, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(-1);
  };

  /**
   * Arrows move, Enter takes, Escape leaves.
   *
   * The list is a portal, so focus stays in the search box the whole time and the
   * "active" row is tracked rather than focused — otherwise every keystroke would
   * bounce focus out of the input the person is typing into.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const last = filtered.length - 1;
      setActive((current) => {
        if (event.key === "ArrowDown") return current >= last ? -1 : current + 1;
        return current <= -1 ? last : current - 1;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      pick(active === -1 ? "" : (filtered[active]?.value ?? ""));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      buttonRef.current?.focus();
    }
  };

  // Keep the active row visible when the arrows walk past the edge of the popover.
  // Optional call: this is a nicety, and jsdom has no scrollIntoView at all — a
  // missing scroll must not take the whole control down with it.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector('[data-active="true"]');
    if (row instanceof HTMLElement) row.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  const pick = (next: string) => {
    onChange(next);
    close();
  };

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
        // Down-arrow opens it, the way a native select does — Enter and Space
        // already do through the button itself.
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open && coords
        ? createPortal(
            <>
              {/* A catcher so a click anywhere else closes the popover. */}
              <div className="fixed inset-0 z-[60]" aria-hidden onClick={close} />
              <div
                role="listbox"
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
                      // Typing narrows the list, so an index into the old one means
                      // nothing — start again at the top rather than on whatever
                      // happens to sit at that position now.
                      setActive(-1);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder="Search…"
                    aria-label="Search options"
                    className="h-7 w-full bg-transparent text-sm focus-visible:outline-none"
                  />
                </div>

                <div ref={listRef} className="flex-1 overflow-y-auto pt-1">
                  {/* Always offer the way back to "no filter". */}
                  <button
                    type="button"
                    data-active={active === -1}
                    onMouseEnter={() => setActive(-1)}
                    onClick={() => pick("")}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground",
                      active === -1 ? "bg-muted" : "",
                    )}
                  >
                    {placeholder}
                    {value === "" ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                  </button>

                  {filtered.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      No matches
                    </p>
                  ) : (
                    filtered.map((option, index) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={option.value === value}
                        // The option's own name, addressable on its own. Its second line joins
                        // the accessible name and matches text filters too, so "Engineering"
                        // otherwise also finds Backend — whose parent is Engineering.
                        data-label={option.label}
                        data-active={index === active}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => pick(option.value)}
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
                        {option.value === value ? (
                          <Check className="h-4 w-4 shrink-0" aria-hidden />
                        ) : null}
                      </button>
                    ))
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
