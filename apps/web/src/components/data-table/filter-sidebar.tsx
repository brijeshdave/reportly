// Author: Brijesh Dave <https://github.com/brijeshdave>
// Right-side filter overlay. Each table declares its filterable fields; the
// operators come from the shared FILTER_OPS the API validates against, so a
// filter the sidebar can build is always one the server will accept.
//
// Nothing here reaches the server until Apply. Every keystroke used to commit
// straight into the list state, which is a request per character: typing eight
// letters into a text filter fired eight queries, each one cancelled and
// superseded by the next, and on a large table the screen locked up while they
// piled in. The panel now holds a draft and applies it in one go — which is also
// what somebody typing a filter expects, since a half-typed word is not a
// question anybody meant to ask.
import type { Filter, FilterOp } from "@reportly/shared";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DateRangeFilter } from "@/components/data-table/date-range-filter.js";
import { MultiSelect } from "@/components/multi-select.js";
import { PeopleFilter } from "@/components/people-filter.js";
import { SearchableSelect, type SelectOption } from "@/components/searchable-select.js";
import { Field, Input } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { filterFor, type ListState } from "@/lib/list-query.js";

/** A filterable column, as declared by the table that owns it. */
export interface FilterDef {
  field: string;
  label: string;
  /**
   * How the value is entered; determines the operator sent to the API.
   * - `select` — a native dropdown, for a handful of fixed options.
   * - `combobox` — a type-to-search dropdown, for many options (people, tags…).
   * - `people` — a person, searched on the server and shown by name. The filter
   *   still stores their id, so a link keeps working; nobody has to read one.
   * - `multiselect` — several values at once, sent as `in`. "Every delete and
   *   every export, by these two people" is then one query rather than four.
   * - `number` — a numeric box, for a count or a score; pair it with `op: "gte"`
   *   for an "at least" filter and say so in the label.
   */
  kind:
    "text" | "select" | "combobox" | "people" | "multiselect" | "boolean" | "number" | "daterange";
  /** Options for `kind: "select"` or `"combobox"`. */
  options?: SelectOption[];
  /** Defaults to `contains` for text and `eq` for the rest. */
  op?: FilterOp;
}

/** Replace a field's draft entry, or add it. One entry per field, as the API expects. */
function upsertDraft(draft: Filter[], filter: Filter): Filter[] {
  const rest = draft.filter((entry) => entry.field !== filter.field);
  return filter.value === "" ? rest : [...rest, filter];
}

function opFor(def: FilterDef): FilterOp {
  if (def.kind === "text") return "contains";
  if (def.kind === "daterange") return "between";
  if (def.kind === "multiselect") return "in";
  return def.op ?? "eq";
}

export function FilterSidebar({
  open,
  onClose,
  defs,
  state,
  onFilterChange,
  onFiltersClear,
}: {
  open: boolean;
  onClose: () => void;
  defs: FilterDef[];
  state: ListState;
  onFilterChange: (filter: Filter) => void;
  onFiltersClear: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  /** The unapplied edits. Seeded from the live filters each time the panel opens. */
  const [draft, setDraft] = useState<Filter[]>(state.filters);

  // Escape closes; opening moves focus into the panel so it is keyboard-usable.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Re-seed on open, so a panel closed mid-edit does not reopen holding changes
  // the table never received — a draft that outlives its own dialog is one
  // somebody applies later without remembering making it.
  useEffect(() => {
    if (open) setDraft(state.filters);
    // Deliberately keyed on `open` alone: re-seeding whenever `state.filters`
    // changes would wipe the draft the moment anything else refreshed it.
  }, [open]);

  if (!open) return null;

  const change = (def: FilterDef, raw: string) => {
    // A boolean column expects a real boolean, and a numeric one a real number —
    // Postgres will not compare an integer with the string the input holds. ""
    // still means "no filter" in both cases.
    const value =
      raw === ""
        ? raw
        : def.kind === "boolean"
          ? raw === "true"
          : def.kind === "number"
            ? Number(raw)
            : raw;
    setDraft((current) => upsertDraft(current, { field: def.field, op: opFor(def), value }));
  };

  /**
   * Send the draft on, one field at a time.
   *
   * The state hook takes a filter at a time, and React batches the lot into one
   * render — so this is a single refetch however many fields changed, which is
   * the whole point of applying rather than typing straight through.
   */
  const apply = () => {
    for (const def of defs) {
      const before = filterFor(state, def.field);
      const after = draft.find((filter) => filter.field === def.field);
      const wasEmpty = before === undefined || before.value === "";
      const isEmpty = after === undefined || after.value === "";
      if (wasEmpty && isEmpty) continue;
      if (before && after && before.value === after.value && before.op === after.op) continue;
      onFilterChange(after ?? { field: def.field, op: opFor(def), value: "" });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-foreground/20" onClick={onClose} aria-hidden />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className="relative flex h-full w-full max-w-sm flex-col border-l border-border bg-card shadow-xl focus-visible:outline-none"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Filters</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close filters">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {defs.map((def) => {
            const current = draft.find((filter) => filter.field === def.field);
            const value = current === undefined ? "" : String(current.value);

            if (def.kind === "daterange") {
              return (
                <Field key={def.field} label={def.label}>
                  {() => (
                    <DateRangeFilter
                      field={def.field}
                      current={current}
                      onChange={(filter) => setDraft((now) => upsertDraft(now, filter))}
                      onClear={() =>
                        setDraft((now) =>
                          upsertDraft(now, { field: def.field, op: "between", value: "" }),
                        )
                      }
                    />
                  )}
                </Field>
              );
            }

            if (def.kind === "people") {
              return (
                <Field key={def.field} label={def.label}>
                  {(props) => (
                    <PeopleFilter
                      {...props}
                      value={value}
                      onChange={(next) => change(def, next)}
                      label={def.label}
                    />
                  )}
                </Field>
              );
            }

            if (def.kind === "multiselect") {
              // The value travels as an array and comes back as one; a single
              // remembered choice arrives as a bare string, so it is widened here
              // rather than every caller having to think about it.
              const values = Array.isArray(value) ? value : value === "" ? [] : [String(value)];
              return (
                <Field key={def.field} label={def.label}>
                  {(props) => (
                    <MultiSelect
                      {...props}
                      values={values}
                      onChange={(next) =>
                        setDraft((now) =>
                          upsertDraft(now, {
                            field: def.field,
                            op: "in",
                            value: next.length > 0 ? next : "",
                          }),
                        )
                      }
                      options={def.options ?? []}
                      ariaLabel={def.label}
                      placeholder={`Any ${def.label.toLowerCase()}`}
                    />
                  )}
                </Field>
              );
            }

            if (def.kind === "combobox") {
              return (
                <Field key={def.field} label={def.label}>
                  {() => (
                    <SearchableSelect
                      value={value}
                      onChange={(next) => change(def, next)}
                      options={def.options ?? []}
                      ariaLabel={def.label}
                      placeholder={`Any ${def.label.toLowerCase()}`}
                    />
                  )}
                </Field>
              );
            }

            return (
              <Field key={def.field} label={def.label}>
                {(props) =>
                  def.kind === "number" ? (
                    <Input
                      {...props}
                      type="number"
                      value={value}
                      onChange={(event) => change(def, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") apply();
                      }}
                      placeholder={def.label}
                    />
                  ) : def.kind === "text" ? (
                    <Input
                      {...props}
                      value={value}
                      onChange={(event) => change(def, event.target.value)}
                      // Enter applies, because a text box that needs a button is
                      // a text box people press Enter in.
                      onKeyDown={(event) => {
                        if (event.key === "Enter") apply();
                      }}
                      placeholder={`Filter by ${def.label.toLowerCase()}`}
                    />
                  ) : (
                    <select
                      {...props}
                      value={value}
                      onChange={(event) => change(def, event.target.value)}
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Any</option>
                      {(def.kind === "boolean"
                        ? [
                            { value: "true", label: "Yes" },
                            { value: "false", label: "No" },
                          ]
                        : (def.options ?? [])
                      ).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )
                }
              </Field>
            );
          })}
        </div>

        <footer className="flex items-center justify-between border-t border-border px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft([]);
              onFiltersClear();
              onClose();
            }}
            disabled={state.filters.length === 0 && draft.length === 0}
          >
            Clear all
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply}>
              Apply filters
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
