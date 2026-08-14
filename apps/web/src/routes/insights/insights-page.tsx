// Author: Brijesh Dave <https://github.com/brijeshdave>
// The Insights pages: the same facts the reports carry, drawn.
//
// Four tabs rather than one long scroll, because they answer four different
// questions and a reader arrives with one of them. The window control sits in a
// single row above the charts and applies to all of them at once — a page where
// each chart carries its own range invites comparing two different periods
// without noticing.
//
// Every chart is fed straight from the API. Nothing is recomputed here: a figure
// derived in the browser is a second definition of a number the reports already
// answer, and the two drift the moment a rule changes.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ChartFrame } from "@/components/charts/chart-frame.js";
import { CompositionChart, RankedBarChart, TrendChart } from "@/components/charts/charts.js";
import { withOther } from "@/components/charts/palette.js";
import { PageTabs } from "@/components/page-tabs.js";
import { Select } from "@/components/ui/form.js";
import { fetchInsights } from "@/services/analytics.js";
import type { ChartPoint } from "@reportly/shared";

/** Windows people actually ask for, rather than a date picker nobody fills in. */
const WINDOWS = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 6 months", days: 182 },
  { label: "Last year", days: 365 },
] as const;

function windowParams(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** `{label,value}` rows in the shape ChartFrame's table wants. */
function rowsOf(points: ChartPoint[], column: string) {
  return points.map((p) => ({ label: p.label, values: [{ name: column, value: p.value }] }));
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "reliability", label: "Reliability" },
  { id: "people", label: "People" },
  { id: "work", label: "Work" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function InsightsPage() {
  const [days, setDays] = useState<number>(90);
  const [tab, setTab] = useState<TabId>("overview");

  const params = windowParams(days);
  const { data, isPending, isError } = useQuery({
    queryKey: ["insights", days],
    queryFn: () => fetchInsights(params),
  });

  const windowLabel = data
    ? `${new Date(data.window.from).toLocaleDateString()} – ${new Date(data.window.to).toLocaleDateString()}`
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-muted-foreground">
          The shape of the work — what is happening, where time goes, and who is doing it.
        </p>
      </div>

      {/* One window for every chart on the page. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Window</span>
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {WINDOWS.map((w) => (
              <option key={w.days} value={w.days}>
                {w.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <PageTabs
        tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
        active={tab}
        onSelect={(id: string) => setTab(id as TabId)}
      />

      {isError ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          The charts could not be loaded.
        </p>
      ) : isPending ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Working it out…
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tab === "overview" ? (
            <>
              <div className="lg:col-span-2">
                <ChartFrame
                  title="Issues and work over time"
                  description="Both are counts of journal entries, so they share one scale."
                  window={windowLabel}
                  columns={["Day", "Issues", "Work logs"]}
                  rows={data.issuesOverTime.map((p) => ({
                    label: p.label,
                    values: [
                      { name: "Issues", value: p.issues },
                      { name: "Work logs", value: p.work },
                    ],
                  }))}
                >
                  <TrendChart data={data.issuesOverTime} />
                </ChartFrame>
              </div>
              <ChartFrame
                title="Issues by category"
                description="What kind of problem keeps coming up."
                window={windowLabel}
                columns={["Category", "Issues"]}
                rows={rowsOf(withOther(data.issuesByCategory), "Issues")}
                emptyMessage="No issues were filed against a category in this window."
              >
                <RankedBarChart data={withOther(data.issuesByCategory)} unit="issues" />
              </ChartFrame>
              <ChartFrame
                title="Where entries stand"
                description="Open against finished, across the window."
                window={windowLabel}
                columns={["Status", "Entries"]}
                rows={rowsOf(withOther(data.entriesByStatus), "Entries")}
              >
                <CompositionChart data={withOther(data.entriesByStatus)} />
              </ChartFrame>
            </>
          ) : null}

          {tab === "reliability" ? (
            <div className="lg:col-span-2">
              <ChartFrame
                title="Downtime by asset"
                description="Closed spans only — an open one has no end, and a bar that grows while you look at it is not a measurement."
                window={windowLabel}
                columns={["Asset", "Minutes"]}
                rows={rowsOf(data.downtimeByAsset, "Minutes")}
                emptyMessage="No downtime was closed against an asset in this window."
              >
                <RankedBarChart data={data.downtimeByAsset} unit="min" colorIndex={1} />
              </ChartFrame>
            </div>
          ) : null}

          {tab === "people" ? (
            <>
              <ChartFrame
                title="Points by person"
                description="Points earned directly, not counting what rolls up a reporting line."
                window={windowLabel}
                columns={["Person", "Points"]}
                rows={rowsOf(data.pointsByPerson, "Points")}
                emptyMessage="Nobody has been scored in this window."
              >
                <RankedBarChart data={data.pointsByPerson} unit="pts" colorIndex={2} />
              </ChartFrame>
              <ChartFrame
                title="Points by department"
                description="Where the recorded work is happening."
                window={windowLabel}
                columns={["Department", "Points"]}
                rows={rowsOf(withOther(data.pointsByDepartment), "Points")}
              >
                <RankedBarChart
                  data={withOther(data.pointsByDepartment)}
                  unit="pts"
                  colorIndex={3}
                />
              </ChartFrame>
            </>
          ) : null}

          {tab === "work" ? (
            <div className="lg:col-span-2">
              <ChartFrame
                title="Issues and work over time"
                description="The daily rhythm of what gets recorded."
                window={windowLabel}
                columns={["Day", "Issues", "Work logs"]}
                rows={data.issuesOverTime.map((p) => ({
                  label: p.label,
                  values: [
                    { name: "Issues", value: p.issues },
                    { name: "Work logs", value: p.work },
                  ],
                }))}
              >
                <TrendChart data={data.issuesOverTime} />
              </ChartFrame>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
