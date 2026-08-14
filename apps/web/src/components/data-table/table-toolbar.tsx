// Author: Brijesh Dave <https://github.com/brijeshdave>
// The controls above a table: active filter chips, column visibility, density,
// and export. Each is optional — a table with no filterable columns shows no
// filter button rather than an inert one.
import type { TableDensity } from "@reportly/shared";
import type { RowData, Table } from "@tanstack/react-table";

import type { tableFeaturesUsed } from "@/components/data-table/data-table.js";
import { Columns3, Download, Filter as FilterIcon, Rows3, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { Badge, Button } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import type { ListState } from "@/lib/list-query.js";
import type { ExportFormat } from "@/services/list.js";

/**
 * A dropdown that stays open until you click outside it or press Escape. It used
 * to close on blur, which collapsed the Columns menu after a single toggle — the
 * re-render moved focus and blur fired — so you could not tick several columns
 * without reopening it each time. `children` is a render function given a `close`
 * so an item that should dismiss the menu (density, export) can, while the column
 * checkboxes leave it open.
 */
function Menu({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Columns3;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Icon className="h-4 w-4" />
        {label}
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 min-w-44 rounded-xl border border-border bg-card p-1 shadow-lg"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** A readable name for a column in the menu, even when its header is blank. */
function columnLabel(header: unknown, id: string): string {
  const text = typeof header === "string" ? header.trim() : "";
  if (text) return text;
  // Fall back to a title-cased id (`createdAt` -> `Created At`) rather than an
  // empty menu row.
  return id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function MenuItem({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted",
        active && "text-primary",
      )}
    >
      {children}
    </button>
  );
}

export function TableToolbar<T extends RowData>({
  table,
  filterDefs,
  state,
  onFilterRemove,
  onFiltersOpen,
  density,
  onDensityChange,
  onToggleColumn,
  onExport,
  busy,
}: {
  table: Table<typeof tableFeaturesUsed, T>;
  filterDefs: FilterDef[];
  state: ListState;
  onFilterRemove: (field: string) => void;
  onFiltersOpen: () => void;
  density: TableDensity;
  onDensityChange: (density: TableDensity) => void;
  onToggleColumn: (id: string) => void;
  onExport?: (format: ExportFormat) => void;
  busy?: boolean;
}) {
  const labelFor = (field: string) => filterDefs.find((def) => def.field === field)?.label ?? field;

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {filterDefs.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={onFiltersOpen}>
            <FilterIcon className="h-4 w-4" />
            Filters
            {state.filters.length > 0 ? <Badge tone="brand">{state.filters.length}</Badge> : null}
          </Button>
        ) : null}

        <Menu label="Columns" icon={Columns3}>
          {() =>
            table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              // Toggling leaves the menu open, so several columns can be set at once.
              .map((column) => (
                <MenuItem key={column.id} onClick={() => onToggleColumn(column.id)}>
                  <input
                    type="checkbox"
                    readOnly
                    checked={column.getIsVisible()}
                    className="pointer-events-none"
                  />
                  {columnLabel(column.columnDef.header, column.id)}
                </MenuItem>
              ))
          }
        </Menu>

        <Menu label="Density" icon={Rows3}>
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  onDensityChange("comfortable");
                  close();
                }}
                active={density === "comfortable"}
              >
                Comfortable
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onDensityChange("compact");
                  close();
                }}
                active={density === "compact"}
              >
                Compact
              </MenuItem>
            </>
          )}
        </Menu>

        {onExport ? (
          <Menu label="Export" icon={Download}>
            {(close) => (
              <>
                <MenuItem
                  onClick={() => {
                    onExport("csv");
                    close();
                  }}
                >
                  Download CSV
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    onExport("json");
                    close();
                  }}
                >
                  Download JSON
                </MenuItem>
              </>
            )}
          </Menu>
        ) : null}
      </div>

      {state.filters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {state.filters.map((filter) => (
            <span
              key={filter.field}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs"
            >
              <span className="font-medium">{labelFor(filter.field)}</span>
              <span className="text-muted-foreground">{String(filter.value)}</span>
              <button
                type="button"
                onClick={() => onFilterRemove(filter.field)}
                aria-label={`Remove ${labelFor(filter.field)} filter`}
                disabled={busy}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
