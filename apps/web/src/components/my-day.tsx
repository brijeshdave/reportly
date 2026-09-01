// Author: Brijesh Dave <https://github.com/brijeshdave>
// The "My day" strip — the adoption engine. Everything you owe and everything you
// earned, in one request, so the first thing a person sees on opening Reports is
// their own work rather than a table of everyone's.
//
// A tile renders only when the server sent its section. That is the whole contract:
// an absent key means the caller lacks the permission behind it, an empty array
// means they are clear. Telling someone "nothing to close" when they may not close
// anything would be a lie, so the tile simply is not there.
import { formatDate, isMineToScore } from "@reportly/shared";
import type { MyDay as MyDayData } from "@reportly/shared";
import { PERMISSIONS } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ClipboardList, Clock, FileText } from "lucide-react";
import { Suspense, lazy } from "react";

import { Can } from "@/components/can.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Card } from "@/components/ui/primitives.js";
import { fetchMyDay } from "@/services/analytics.js";

/**
 * The one chart on this page, fetched only when it is going to be drawn.
 *
 * Statically imported it dragged the whole charting library — a third of the
 * app's JavaScript — onto the landing page for everybody, including the people
 * whose permissions mean the tile below never renders at all. Gating the render
 * does not gate the download.
 */
const DashboardTrend = lazy(() =>
  import("@/components/charts/dashboard-chart.js").then((m) => ({ default: m.DashboardTrend })),
);

/** Minutes → "3h 20m". Compact on purpose: these sit in a tile, not a report. */
function humanMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function TileHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-xs uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function EmptyLine({
  icon: Icon,
  children,
}: {
  icon: typeof ClipboardList;
  children: React.ReactNode;
}) {
  return (
    <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="h-4 w-4" />
      {children}
    </p>
  );
}

export function MyDay() {
  const day = useQuery({ queryKey: ["my-day"], queryFn: fetchMyDay });

  if (day.isLoading) {
    return (
      <Card className="p-4">
        <Spinner />
      </Card>
    );
  }
  if (!day.data) return null;

  const d: MyDayData = day.data;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <PointsTile day={d} />
      <TodayTile day={d} />
      {/* The same rule the Reviews page uses. This tile showed every depth while
          Reviews showed only direct reports, so one page said "nothing to review"
          and the other listed the whole organisation. */}
      {d.pendingAppraisals ? (
        <AppraisalsTile items={d.pendingAppraisals.filter(isMineToScore)} />
      ) : null}
      {d.openDowntimes ? <DowntimeTile items={d.openDowntimes} /> : null}
      {d.openTasks ? <TasksTile items={d.openTasks} /> : null}
      {/* Gated at the call site rather than inside: fetching data the caller may
          not hold and then hiding it is a 403 in the network tab. */}
      <Can permission={PERMISSIONS.INSIGHTS_VIEW}>
        {/* No skeleton: the tiles above are the page, and a box that flashes in
            under them draws the eye to the least important thing on it. */}
        <Suspense fallback={null}>
          <DashboardTrend />
        </Suspense>
      </Can>
    </div>
  );
}

function PointsTile({ day }: { day: MyDayData }) {
  return (
    <Card className="p-4">
      <TileHeading>Your points</TileHeading>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{day.points.total}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {day.points.own} your own · {day.points.rollup} from your team
      </p>
    </Card>
  );
}

function TodayTile({ day }: { day: MyDayData }) {
  return (
    <Card className="p-4">
      <TileHeading>Filed today</TileHeading>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{day.myReports.length}</p>
      {day.draftCount > 0 ? (
        <Link to="/journal" className="mt-1 block text-xs text-muted-foreground hover:underline">
          {day.draftCount} unfinished draft{day.draftCount === 1 ? "" : "s"}
        </Link>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No drafts waiting</p>
      )}
      <div className="mt-2 flex flex-col gap-1">
        {day.myReports.slice(0, 3).map((r) => (
          <Link
            key={r.id}
            to="/journal/$reportId"
            params={{ reportId: r.id }}
            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted"
          >
            <span className="truncate">{r.title}</span>
            {r.state === "draft" ? <Badge tone="neutral">draft</Badge> : null}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function AppraisalsTile({ items }: { items: NonNullable<MyDayData["pendingAppraisals"]> }) {
  return (
    <Card className="p-4">
      <TileHeading>Awaiting your review</TileHeading>
      {items.length === 0 ? (
        <EmptyLine icon={ClipboardList}>Nothing to score — you&rsquo;re clear.</EmptyLine>
      ) : null}
      <div className="mt-2 flex flex-col gap-1">
        {items.map((p) => (
          <Link
            key={p.reportId}
            to="/journal/$reportId"
            params={{ reportId: p.reportId }}
            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm hover:bg-muted"
          >
            <span className="truncate">
              {p.title}
              <span className="ml-2 text-xs text-muted-foreground">{p.authorName}</span>
            </span>
            {p.severityName ? <Badge tone="brand">{p.severityName}</Badge> : null}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function DowntimeTile({ items }: { items: NonNullable<MyDayData["openDowntimes"]> }) {
  return (
    <Card className="p-4">
      <TileHeading>Still down</TileHeading>
      {items.length === 0 ? <EmptyLine icon={Clock}>Nothing of yours is down.</EmptyLine> : null}
      <div className="mt-2 flex flex-col gap-1">
        {items.map((d) => (
          <Link
            key={d.id}
            to="/journal/$reportId"
            params={{ reportId: d.reportId }}
            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm hover:bg-muted"
          >
            <span className="truncate">{d.targetLabel}</span>
            {/* An open outage has an age, not a duration — it is still climbing. */}
            <Badge tone="danger">{humanMinutes(d.openForMinutes)}</Badge>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function TasksTile({ items }: { items: NonNullable<MyDayData["openTasks"]> }) {
  return (
    <Card className="p-4">
      <TileHeading>On your plate</TileHeading>
      {items.length === 0 ? <EmptyLine icon={FileText}>No open tasks.</EmptyLine> : null}
      <div className="mt-2 flex flex-col gap-1">
        {items.map((t) => (
          <Link
            key={t.id}
            to="/tasks/$taskId"
            params={{ taskId: t.id }}
            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm hover:bg-muted"
          >
            <span className="truncate">{t.title}</span>
            {t.overdue ? (
              <Badge tone="danger">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                overdue
              </Badge>
            ) : t.dueAt ? (
              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(t.dueAt)}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </Card>
  );
}
