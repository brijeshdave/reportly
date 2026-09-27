// Author: Brijesh Dave <https://github.com/brijeshdave>
// End-user reporting: who the work was *about*, rather than who did it.
//
// Two questions on one page, because they are the same question at two zoom levels —
// "who keeps needing help" (a row per person) and "what exactly happened to them" (a
// row per entry). Both run the report engine's own sources, so what is on screen is
// the same thing the Excel and the printable page produce, and a saved view in the
// Reports library of either source reads identically.
import {
  PERMISSIONS,
  REPORT_RANGE_LABELS,
  type ReportRange,
  type ReportResult,
  type ReportSource,
  formatDate,
} from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Download, FileText, Printer, TriangleAlert, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { usePermission } from "@/components/can.js";
import { RankedBarChart } from "@/components/charts/charts.js";
import { ChartFrame } from "@/components/charts/chart-frame.js";
import { MultiSelect } from "@/components/multi-select.js";
import { SegmentedTabs } from "@/components/segmented-tabs.js";
import { Select, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDepartments } from "@/services/departments.js";
import { exportReportHtml, exportReportXlsx, runReport } from "@/services/reports.js";

/** The windows worth offering here. A custom range belongs in the report workspace. */
const RANGES: ReportRange[] = [
  "this_month",
  "last_month",
  "this_week",
  "last_week",
  "this_year",
  "this_fy",
  "last_fy",
];

type View = "summary" | "issues";

const SOURCE: Record<View, ReportSource> = {
  summary: "end_user_summary",
  issues: "end_user_issues",
};

/** Sum one column of a report, reading the cells the server already formatted. */
function sumColumn(result: ReportResult | undefined, column: string): number {
  let total = 0;
  for (const group of result?.groups ?? []) {
    for (const row of group.rows) total += Number(row.cells[column] ?? 0) || 0;
  }
  return total;
}

function allRows(result: ReportResult | undefined) {
  return (result?.groups ?? []).flatMap((g) => g.rows);
}

export function EndUserReportPage() {
  const [view, setView] = useState<View>("summary");
  const [range, setRange] = useState<ReportRange>("this_month");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);

  const { data: session } = useQuery(sessionQuery);
  const maySeeSummary = usePermission(PERMISSIONS.REPORTS_VIEW_END_USER_SUMMARY);
  const maySeeIssues = usePermission(PERMISSIONS.REPORTS_VIEW_END_USER_ISSUES);

  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const deptOptions = useMemo(
    () =>
      departmentOptions(
        (departments.data ?? [])
          .filter((d) => d.companyId === session?.companyId)
          .map((d) => ({ value: d.id, name: d.name, path: d.path })),
      ),
    [departments.data, session?.companyId],
  );

  // The department filter narrows by the *entry's* department — the team that dealt
  // with it. The summary's Department column is the end user's own, which is a
  // different fact and deliberately not folded into one filter.
  const definition = useMemo(
    () => ({
      source: SOURCE[view],
      range,
      // Both sources have fixed columns and no grouping; these are what the schema
      // asks for, and the server ignores them for anything but the journal.
      grouping: "none" as const,
      columns: ["endUser"],
      filters: departmentIds.length > 0 ? { departmentId: departmentIds } : {},
    }),
    [view, range, departmentIds],
  );

  const report = useQuery({
    queryKey: ["reports", "end-users", definition],
    queryFn: () => runReport({ definition }),
    // A report is a snapshot: re-running it on every focus change would move the
    // numbers under somebody reading them out in a meeting.
    staleTime: 60_000,
    enabled: view === "summary" ? maySeeSummary : maySeeIssues,
  });

  const rows = allRows(report.data);
  const columns = report.data?.meta.columns ?? [];
  const labels = report.data?.meta.columnLabels ?? [];

  // The ten people it happened to most — the chart that answers the question the
  // page exists for. Only on the summary, where a row is a person.
  const topTen = useMemo(
    () =>
      view !== "summary"
        ? []
        : rows
            .slice(0, 10)
            .map((r) => ({ label: r.cells.endUser ?? "—", value: Number(r.cells.entries ?? 0) })),
    [rows, view],
  );

  const filename = (ext: string) =>
    `end-users-${view}-${new Date().toISOString().slice(0, 10)}.${ext}`;

  const may = view === "summary" ? maySeeSummary : maySeeIssues;

  return (
    <>
      <PageHeader
        title="End users"
        description="Whose equipment keeps failing, and who keeps needing help. Every figure here comes from entries that name an end user — an entry recorded against a whole department is not about one person and does not appear."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!may || rows.length === 0}
              onClick={() => void exportReportXlsx({ definition }, filename("xlsx"))}
            >
              <Download className="h-4 w-4" />
              Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!may || rows.length === 0}
              onClick={() => void exportReportHtml({ definition }, filename("html"))}
            >
              <Printer className="h-4 w-4" />
              Printable
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 pt-2">
        <SegmentedTabs<View>
          ariaLabel="What the report shows"
          value={view}
          onChange={setView}
          segments={[
            { value: "summary", label: "Per person" },
            { value: "issues", label: "Every entry" },
          ]}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Window</span>
          <Select value={range} onChange={(e) => setRange(e.target.value as ReportRange)}>
            {RANGES.map((r) => (
              <option key={r} value={r}>
                {REPORT_RANGE_LABELS[r]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-56 flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Department that dealt with it</span>
          <MultiSelect
            ariaLabel="Department"
            values={departmentIds}
            onChange={setDepartmentIds}
            options={deptOptions}
            placeholder="Any department"
          />
        </label>
      </div>

      {!may ? (
        <EmptyState
          icon={Users}
          title="Not available to you"
          description="This report needs the end-user reporting permission. Ask an administrator to add it to your role."
        />
      ) : report.error ? (
        <div className="pt-4">
          <ErrorAlert error={report.error} />
        </div>
      ) : report.isLoading ? (
        <div className="pt-6">
          <Spinner />
        </div>
      ) : (
        <>
          {view === "summary" ? (
            <div className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="People affected"
                value={rows.length}
                icon={Users}
                hint="named on at least one entry"
              />
              <StatCard
                label="Entries about them"
                value={sumColumn(report.data, "entries")}
                icon={FileText}
              />
              <StatCard
                label="Of which issues"
                value={sumColumn(report.data, "issues")}
                icon={CircleAlert}
              />
              <StatCard
                label="Still open"
                value={sumColumn(report.data, "open")}
                icon={TriangleAlert}
                hint="not yet in a finished status"
              />
            </div>
          ) : null}

          {view === "summary" && topTen.length > 0 ? (
            <div className="pt-4">
              <ChartFrame
                title="Who it happened to most"
                description="Entries naming each person in the window. Read it with the table below — ten entries about one printer is a different problem from ten about one person."
                window={
                  report.data
                    ? `${formatDate(report.data.meta.from)} – ${formatDate(report.data.meta.toInclusive)}`
                    : undefined
                }
                rows={topTen.map((p) => ({
                  label: p.label,
                  values: [{ name: "Entries", value: p.value }],
                }))}
                columns={["Entries"]}
              >
                <div className="h-72">
                  <RankedBarChart data={topTen} unit="entries" />
                </div>
              </ChartFrame>
            </div>
          ) : null}

          <div className="pt-4">
            {rows.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No end users named in this window"
                description="Either nothing was filed about a particular person, or entries are still being recorded against whole departments. The End user field sits under 'What is it about?' on an entry."
              />
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {columns.map((col, i) => (
                        <th
                          key={col}
                          className="whitespace-nowrap px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {labels[i] ?? col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-border/60 last:border-0">
                        {columns.map((col) => (
                          <td key={col} className="whitespace-nowrap px-4 py-2">
                            {row.cells[col] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}
