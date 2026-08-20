// Author: Brijesh Dave <https://github.com/brijeshdave>
// The one table implementation. Pagination, sorting and filtering are all done by
// the server (`manual*` below), so TanStack Table is used purely to model columns
// and visibility — it never slices or reorders the rows it is handed.
import type { TableDensity } from "@reportly/shared";
import {
  columnVisibilityFeature,
  flexRender,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type RowData,
} from "@tanstack/react-table";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from "lucide-react";
import { useState, type ReactNode } from "react";

import { FilterSidebar, type FilterDef } from "@/components/data-table/filter-sidebar.js";
import { PaginationBar } from "@/components/data-table/pagination-bar.js";
import { TableToolbar } from "@/components/data-table/table-toolbar.js";
import { Button, EmptyState } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { errorMessage } from "@/lib/error-message.js";
import type { ListResource } from "@/hooks/use-list-resource.js";

/**
 * The only table feature this app registers.
 *
 * v9 makes you ask for each feature rather than bundling them all, and asking
 * honestly is the useful part: pagination, sorting and filtering are done by the
 * server here, so the table models columns and their visibility and nothing else.
 * Registering `rowSortingFeature` would ship a sorting engine that never sorts.
 */
export const tableFeaturesUsed = tableFeatures({ columnVisibilityFeature });

/**
 * A column definition for this app's tables.
 *
 * Exported so the fifteen list screens name this instead of `ColumnDef` from the
 * library. v9 added a features generic to nearly every public type, which is what
 * turned a version bump into edits in fifteen files; going through one alias means
 * the next major reaches three.
 */
export type TableColumn<T extends RowData> = ColumnDef<typeof tableFeaturesUsed, T, unknown> & {
  /**
   * Whether this header offers sorting. **Ours, not the library's.**
   *
   * It shares a name with v8's option and means something different: sorting here
   * is done by the server, so this only decides whether the header renders as a
   * button that calls `onSortChange`. v9 removed the property from `ColumnDef`
   * unless `rowSortingFeature` is registered — and registering it would ship a
   * client-side sorting engine that must never run, since the rows on screen are
   * one page of many.
   */
  enableSorting?: boolean;
};

const ROW_PADDING: Record<TableDensity, string> = {
  comfortable: "px-4 py-3",
  compact: "px-4 py-1.5",
};

export interface DataTableProps<T extends RowData> extends ListResource<T> {
  columns: TableColumn<T>[];
  /** Filterable fields; omit for a table with no filters. */
  filterDefs?: FilterDef[];
  /** Shown when the resource has no rows at all. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Renders one row as a card on small screens. */
  renderCard?: (row: T) => ReactNode;
  /**
   * Columns hidden until the viewer turns them on from the Columns menu. Keyed by
   * column id, `false` = hidden. Use for wide or detail-heavy columns that would
   * crowd the table by default.
   */
  initialColumnVisibility?: ColumnVisibilityState;
  /** Opens a detail view for a row. When set, rows become clickable. */
  onRowClick?: (row: T) => void;
}

export function DataTable<T extends RowData>({
  columns,
  filterDefs = [],
  emptyTitle = "Nothing here yet",
  emptyDescription,
  renderCard,
  initialColumnVisibility,
  onRowClick,
  ...list
}: DataTableProps<T>) {
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(
    initialColumnVisibility ?? {},
  );
  const [density, setDensity] = useState<TableDensity | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The user's saved density is the starting point; the toolbar overrides it for
  // this table only, until they change it in their settings.
  const activeDensity = density ?? list.density;

  // The core row model is automatic in v9, and the `manual*` flags are gone with
  // the features that used to need them: a sorting engine that is never
  // registered cannot sort the rows behind your back. `pageCount` went the same
  // way — the pagination bar reads the server's own totals, not the table's.
  const table = useTable({
    features: tableFeaturesUsed,
    data: list.result?.data ?? [],
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
  });

  if (list.error) {
    return (
      <div className="rounded-2xl border border-border bg-card">
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load this list"
          description={errorMessage(list.error)}
          action={
            <Button size="sm" variant="secondary" onClick={list.refetch}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const rows = table.getRowModel().rows;
  const showSkeleton = list.isLoading;
  const isEmpty = !showSkeleton && rows.length === 0;
  // An empty result with filters applied is a different problem to an empty table.
  const filtered = list.state.filters.length > 0;

  return (
    <>
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-border bg-card transition-opacity",
          // A background refetch dims the table rather than replacing it.
          list.isFetching && !showSkeleton && "opacity-60",
        )}
      >
        <TableToolbar
          table={table}
          filterDefs={filterDefs}
          state={list.state}
          onFilterRemove={list.onFilterRemove}
          onFiltersOpen={() => setFiltersOpen(true)}
          density={activeDensity}
          onDensityChange={setDensity}
          // A direct functional update, so toggling several columns in a row each
          // build on the last — TanStack's own toggle read a stale snapshot across
          // re-renders, so only the first click in an open menu took effect.
          onToggleColumn={(id) =>
            setColumnVisibility((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }))
          }
          onExport={list.onExport ? (format) => void list.onExport?.(format) : undefined}
          busy={list.isFetching}
        />

        {showSkeleton ? (
          <TableSkeleton columns={table.getVisibleLeafColumns().length} density={activeDensity} />
        ) : isEmpty ? (
          <EmptyState
            icon={Inbox}
            title={filtered ? "No matches" : emptyTitle}
            description={
              filtered ? "No rows match the current filters. Try clearing one." : emptyDescription
            }
            action={
              filtered ? (
                <Button size="sm" variant="secondary" onClick={list.onFiltersClear}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Above the rows as well as below: on a full page of results the
                controls were only reachable by scrolling past every row, which is
                a long way to go to say "next". Same controls, same counts — the
                bottom one stays for anybody who has read to the end. */}
            {list.result ? (
              <PaginationBar
                result={list.result}
                onPageChange={list.onPageChange}
                onPageSizeChange={list.onPageSizeChange}
                disabled={list.isFetching}
                placement="top"
              />
            ) : null}

            {/* Desktop: a real table. */}
            <div className={cn("overflow-x-auto", renderCard && "hidden md:block")}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {table.getVisibleLeafColumns().map((column) => {
                      // Cast because the flag is ours: it lives on the column
                      // definitions this app writes, not on the library's type.
                      const sortable = (column.columnDef as TableColumn<T>).enableSorting !== false;
                      const active = list.state.sortBy === column.id;
                      const Icon = !active
                        ? ChevronsUpDown
                        : list.state.sortDir === "asc"
                          ? ArrowUp
                          : ArrowDown;

                      return (
                        <th
                          key={column.id}
                          scope="col"
                          className={cn(
                            "whitespace-nowrap font-medium text-muted-foreground",
                            ROW_PADDING[activeDensity],
                          )}
                          aria-sort={
                            active
                              ? list.state.sortDir === "asc"
                                ? "ascending"
                                : "descending"
                              : undefined
                          }
                        >
                          {sortable ? (
                            <button
                              type="button"
                              onClick={() => list.onSortChange(column.id)}
                              className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                              {String(column.columnDef.header ?? column.id)}
                              <Icon
                                className={cn("h-3.5 w-3.5", active && "text-foreground")}
                                aria-hidden
                              />
                            </button>
                          ) : (
                            String(column.columnDef.header ?? column.id)
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      className={cn(
                        "border-b border-border last:border-0 hover:bg-muted/50",
                        onRowClick && "cursor-pointer",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className={ROW_PADDING[activeDensity]}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phones: the same rows as cards, when the table supplies a renderer. */}
            {renderCard ? (
              <div className="flex flex-col gap-2 p-3 md:hidden">
                {rows.map((row) => (
                  <div key={row.id} className="rounded-xl border border-border p-3">
                    {renderCard(row.original)}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}

        {list.result && !isEmpty ? (
          <PaginationBar
            result={list.result}
            onPageChange={list.onPageChange}
            onPageSizeChange={list.onPageSizeChange}
            disabled={list.isFetching}
          />
        ) : null}
      </div>

      <FilterSidebar
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        defs={filterDefs}
        state={list.state}
        onFilterChange={list.onFilterChange}
        onFiltersClear={list.onFiltersClear}
      />
    </>
  );
}

function TableSkeleton({ columns, density }: { columns: number; density: TableDensity }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Loading rows">
      {Array.from({ length: 5 }).map((_, rowIndex) => (
        <div key={rowIndex} className={cn("flex gap-4", ROW_PADDING[density])}>
          {Array.from({ length: Math.max(columns, 1) }).map((__, cellIndex) => (
            <div key={cellIndex} className="h-4 flex-1 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}
