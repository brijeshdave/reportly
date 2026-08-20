// Author: Brijesh Dave <https://github.com/brijeshdave>
// Pagination controls. Every page number and boundary comes from the API's
// PaginatedResult, so the client never recomputes page maths and can never
// disagree with the server about where the last page is.
import { PAGE_SIZE_OPTIONS, type PageSize, type PaginatedResult } from "@reportly/shared";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { rowRange } from "@/lib/list-query.js";

export function PaginationBar<T>({
  result,
  onPageChange,
  onPageSizeChange,
  disabled,
  placement = "bottom",
}: {
  result: PaginatedResult<T>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
  disabled?: boolean;
  /** Which edge it sits on — the rule sits between the bar and the rows. */
  placement?: "top" | "bottom";
}) {
  const { page, pageSize, total, lastPage, firstPage, previousPage, nextPage } = result;
  const { from, to } = rowRange(page, pageSize, total);

  const steps = [
    { label: "First page", icon: ChevronsLeft, target: firstPage, enabled: result.hasPrevious },
    {
      label: "Previous page",
      icon: ChevronLeft,
      target: previousPage,
      enabled: result.hasPrevious,
    },
    { label: "Next page", icon: ChevronRight, target: nextPage, enabled: result.hasNext },
    { label: "Last page", icon: ChevronsRight, target: lastPage, enabled: result.hasNext },
  ];

  return (
    <div
      // The whole bar is the named thing, not just its buttons: with one above the
      // rows and one below, the row count and the page-size control are duplicated
      // too, and a screen reader needs to know which set it is in.
      role="group"
      aria-label={
        placement === "top" ? "Pagination, above the table" : "Pagination, below the table"
      }
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 px-4 py-3",
        placement === "top" ? "border-b border-border" : "border-t border-border",
      )}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {/* Unique per bar: with one above and one below, a shared id would point
            both labels at the same control. */}
        <label htmlFor={`rows-per-page-${placement}`} className="whitespace-nowrap">
          Rows per page
        </label>
        <select
          id={`rows-per-page-${placement}`}
          value={pageSize}
          disabled={disabled}
          onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSize)}
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? "No rows" : `${from}-${to} of ${total}`}
      </p>

      <nav className="flex items-center gap-1">
        {steps.map(({ label, icon: Icon, target, enabled }) => (
          <Button
            key={label}
            variant="ghost"
            size="icon"
            aria-label={label}
            // `target` is null exactly when the step is unavailable.
            disabled={disabled || !enabled || target === null}
            onClick={() => target !== null && onPageChange(target)}
            className="h-8 w-8"
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        <span className="ml-2 whitespace-nowrap text-sm text-muted-foreground">
          Page {page} of {lastPage}
        </span>
      </nav>
    </div>
  );
}
