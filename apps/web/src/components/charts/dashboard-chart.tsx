// Author: Brijesh Dave <https://github.com/brijeshdave>
// The dashboard's chart: the last 30 days of filing, at a glance.
//
// It obeys the same contract as every other tile on that screen — it renders only
// when the data is there, and disappears rather than showing an empty frame. On
// the dashboard an absent tile means "not yours or nothing to show", and a chart
// that insists on drawing an empty axis breaks that reading.
//
// Deliberately gated on `insights:view` at the call site rather than fetching and
// hiding: asking for data the caller may not have, then not drawing it, is a 403
// in the network tab and a lie in the UI.
//
// Recharts is imported here, which is the one place it reaches the main bundle.
// That is a considered trade: the Insights *pages* are lazy, but a dashboard tile
// that arrives a second after everything else reads as broken.
import { useQuery } from "@tanstack/react-query";

import { TrendChart } from "@/components/charts/charts.js";
import { Card } from "@/components/ui/primitives.js";
import { fetchInsights } from "@/services/analytics.js";

function thirtyDays(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function DashboardTrend() {
  const params = thirtyDays();
  const { data } = useQuery({
    queryKey: ["insights", "dashboard", 30],
    queryFn: () => fetchInsights(params),
  });

  // Nothing filed in the window is not an error and not an empty chart — it is
  // simply a tile that has nothing to say, so it says nothing.
  const points = data?.issuesOverTime ?? [];
  if (points.length === 0) return null;

  const issues = points.reduce((n, p) => n + p.issues, 0);
  const work = points.reduce((n, p) => n + p.work, 0);

  return (
    <Card className="p-4 sm:col-span-2">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">The last 30 days</h2>
        {/* The totals in text, beside the picture. The chart shows the shape; the
            numbers answer "how many" without anyone reading them off an axis. */}
        <p className="text-xs text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">{issues}</span> issues ·{" "}
          <span className="tabular-nums font-medium text-foreground">{work}</span> work logs
        </p>
      </div>
      <div className="h-40 w-full">
        <TrendChart data={points} />
      </div>
    </Card>
  );
}
