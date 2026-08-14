// Author: Brijesh Dave <https://github.com/brijeshdave>
// The frame every chart sits in: a title, the window it covers, and a toggle to
// read the same numbers as a table.
//
// The table is not a nicety. Three slots of the light palette fall below 3:1
// against white — the palette validator says so — and that warning obligates
// relief: either a visible label on every mark, or a table view. Charts here take
// the table, because it also answers the screen-reader case, the print case and
// the "I want the actual number" case with one control instead of three.
//
// An empty state is a first-class outcome. A chart with no data should say so in
// words: an empty axis reads as "nothing happened", which is a claim, when the
// truth is usually "nothing in this window".
import { Table2, TrendingUp } from "lucide-react";
import { useId, useState } from "react";

interface ChartFrameProps {
  title: string;
  /** What the reader is looking at, in a sentence. Skipped when the title says it. */
  description?: string;
  /** The period the figures cover — a figure without its window invites a wrong assumption. */
  window?: string;
  /** Rows for the table view: the same numbers the marks are drawn from. */
  rows: { label: string; values: { name: string; value: number }[] }[];
  /** Column headers for the table view, in series order. */
  columns: string[];
  /** Shown instead of the chart when there is nothing to draw. */
  emptyMessage?: string;
  children: React.ReactNode;
}

export function ChartFrame({
  title,
  description,
  window: windowLabel,
  rows,
  columns,
  emptyMessage = "Nothing in this window.",
  children,
}: ChartFrameProps) {
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  const isEmpty = rows.length === 0;

  return (
    <figure className="rounded-2xl border border-border bg-card p-4">
      <figcaption className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
          {windowLabel ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{windowLabel}</p>
          ) : null}
        </div>
        {!isEmpty ? (
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            aria-controls={tableId}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {asTable ? (
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Table2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {asTable ? "Chart" : "Table"}
          </button>
        ) : null}
      </figcaption>

      {isEmpty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : asTable ? (
        <div id={tableId} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {columns[0]}
                </th>
                {columns.slice(1).map((c) => (
                  <th key={c} scope="col" className="py-2 pl-3 text-right font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {row.label}
                  </th>
                  {row.values.map((v) => (
                    <td key={v.name} className="py-1.5 pl-3 text-right tabular-nums">
                      {v.value.toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div id={tableId} className="h-64 w-full">
          {children}
        </div>
      )}
    </figure>
  );
}
