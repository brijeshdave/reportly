// Author: Brijesh Dave <https://github.com/brijeshdave>
// The self-serve points page, for every user: your own points ledger and your team's,
// and a per-person summary. The rows are scoped server-side to your reporting line (the
// whole company for an analytics viewer), so a plain member sees only themselves. Both
// tabs share a window + source filter; the data is the same source-aware ledger the
// leaderboard is built from.
import {
  POINTS_SOURCE_FILTERS,
  POINTS_SOURCE_FILTER_LABELS,
  REPORT_RANGES,
  REPORT_RANGE_LABELS,
  formatDate,
  type PointsSourceFilter,
  type ReportRange,
} from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { useState } from "react";

import { SegmentedTabs } from "@/components/segmented-tabs.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Spinner } from "@/components/ui/form.js";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { fetchPointsLedger, fetchPointsSummary, type PointsFilters } from "@/services/points.js";
import { Toolbar, ToolbarSelect } from "@/routes/routines/filters.js";

type Tab = "ledger" | "summary";

export function MyPointsPage() {
  const [tab, setTab] = useState<Tab>("ledger");
  const [range, setRange] = useState<ReportRange>("this_fy");
  const [source, setSource] = useState<PointsSourceFilter>("all");
  const [from, setFrom] = useState(dayOffset(-30));
  const [to, setTo] = useState(dayOffset(0));

  const filters: PointsFilters = {
    range,
    source,
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
  };

  return (
    <>
      <PageHeader
        title="My points"
        description="How your points were earned — your own and your team's. Switch to the summary for per-person totals."
      />

      <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
        <SegmentedTabs
          ariaLabel="Which view"
          value={tab}
          onChange={setTab}
          segments={[
            { value: "ledger" as const, label: "Ledger" },
            { value: "summary" as const, label: "Summary" },
          ]}
        />
        <Toolbar className="pt-0">
          <ToolbarSelect label="Period" value={range} onChange={(v) => setRange(v as ReportRange)}>
            {REPORT_RANGES.map((r) => (
              <option key={r} value={r}>
                {REPORT_RANGE_LABELS[r]}
              </option>
            ))}
          </ToolbarSelect>
          <ToolbarSelect
            label="Source"
            value={source}
            onChange={(v) => setSource(v as PointsSourceFilter)}
          >
            {POINTS_SOURCE_FILTERS.map((s) => (
              <option key={s} value={s}>
                {POINTS_SOURCE_FILTER_LABELS[s]}
              </option>
            ))}
          </ToolbarSelect>
          {range === "custom" ? (
            <>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-muted-foreground">From</span>
                <Input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 w-40"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-muted-foreground">To</span>
                <Input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 w-40"
                />
              </label>
            </>
          ) : null}
        </Toolbar>
      </div>

      <div className="pt-3">
        {tab === "ledger" ? <LedgerTab filters={filters} /> : <SummaryTab filters={filters} />}
      </div>
    </>
  );
}

function LedgerTab({ filters }: { filters: PointsFilters }) {
  const q = useQuery({
    queryKey: ["points", "ledger", filters],
    queryFn: () => fetchPointsLedger(filters),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const rows = q.data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Coins}
        title="No points yet"
        description="No points were earned in this period."
      />
    );
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Detail</th>
            <th className="px-3 py-2 font-medium">Person</th>
            <th className="px-3 py-2 font-medium">Department</th>
            <th className="px-3 py-2 font-medium">Kind</th>
            <th className="px-4 py-2 text-right font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="whitespace-nowrap px-4 py-1.5">{formatDate(`${r.date}T00:00:00`)}</td>
              <td className="px-3 py-1.5">
                <Badge tone={r.source === "routine" ? "brand" : "neutral"}>
                  {r.source === "routine" ? "Routine" : "Journal"}
                </Badge>
              </td>
              <td className="px-3 py-1.5">{r.detail}</td>
              <td className="whitespace-nowrap px-3 py-1.5">{r.person}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {r.department ?? "—"}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {r.kind === "rollup" ? "Team" : "Own"}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums">{r.points}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-medium">
            <td className="px-4 py-2" colSpan={6}>
              Total
            </td>
            <td className="px-4 py-2 text-right tabular-nums">{q.data?.total ?? 0}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

function SummaryTab({ filters }: { filters: PointsFilters }) {
  const q = useQuery({
    queryKey: ["points", "summary", filters],
    queryFn: () => fetchPointsSummary(filters),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorAlert error={q.error} />;
  const rows = q.data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Coins}
        title="No points yet"
        description="No points were earned in this period."
      />
    );
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Person</th>
            <th className="px-3 py-2 text-right font-medium">Own</th>
            <th className="px-3 py-2 text-right font-medium">From team</th>
            <th className="px-4 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className="border-t border-border">
              <td className="whitespace-nowrap px-4 py-1.5">{r.name}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.own}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                {r.team}
              </td>
              <td className="px-4 py-1.5 text-right font-medium tabular-nums">{r.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-medium">
            <td className="px-4 py-2">Total</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-4 py-2 text-right tabular-nums">{q.data?.total ?? 0}</td>
          </tr>
        </tfoot>
      </table>
    </Card>
  );
}

/** A date `days` from today (negative = past), as YYYY-MM-DD. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
