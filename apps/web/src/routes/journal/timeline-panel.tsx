// Author: Brijesh Dave <https://github.com/brijeshdave>
// A report's status history and what it implies — how long it took somebody to pick
// it up, and how long to fix.
//
// Named "Status timeline", not "History", because the report detail also carries a
// change-history panel (every field edit, from `entity_history`). Two cards both
// labelled History is how somebody ends up reading the wrong one and concluding a
// field was never touched.
//
// Both figures come from the API, derived from the stored transitions. Nothing here
// computes a duration: the rules for "resolved" are subtle enough (a reopened report
// is not resolved; a Completed → Closed pair resolved at Completed) that a second
// implementation in the browser would eventually disagree with the first.
import { formatDateTime } from "@reportly/shared";
import type { JournalTimeline } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { History, RotateCcw } from "lucide-react";

import { Spinner } from "@/components/ui/form.js";
import { Badge, Card } from "@/components/ui/primitives.js";
import { fetchTimeline } from "@/services/analytics.js";

function humanMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function TimelinePanel({ reportId }: { reportId: string }) {
  const timeline = useQuery({
    queryKey: ["reports", reportId, "timeline"],
    queryFn: () => fetchTimeline(reportId),
  });

  if (timeline.isLoading) {
    return (
      <Card className="p-6">
        <Spinner />
      </Card>
    );
  }
  if (!timeline.data) return null;

  const t: JournalTimeline = timeline.data;

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" />
          Status timeline
        </h2>
        {t.timing.reopened ? (
          // Worth saying out loud: it changes what the resolution time below means.
          <Badge tone="danger">
            <RotateCcw className="mr-1 inline h-3 w-3" />
            reopened
          </Badge>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Picked up in</dt>
          <dd className="tabular-nums">{humanMinutes(t.timing.timeToRespondMinutes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t.timing.reopened ? "Fixed in (total)" : "Fixed in"}
          </dt>
          <dd className="tabular-nums">{humanMinutes(t.timing.timeToResolveMinutes)}</dd>
        </div>
      </dl>

      {t.timing.reopened && t.timing.resolvedAt === null ? (
        <p className="text-xs text-muted-foreground">
          Open again after being resolved, so there is no fix time yet.
        </p>
      ) : null}

      <ol className="flex flex-col gap-2 border-t border-border pt-3">
        {t.events.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">
              {/* The creation event has no `from` — it is where the clock starts,
                  not a move between two statuses. */}
              {e.fromStatusName ? (
                <>
                  <span className="text-muted-foreground">{e.fromStatusName}</span>
                  <span className="mx-1 text-muted-foreground">→</span>
                </>
              ) : (
                <span className="mr-1 text-muted-foreground">Filed as</span>
              )}
              <span className="font-medium">{e.toStatusName ?? "no status"}</span>
              <span className="ml-2 text-xs text-muted-foreground">{e.changedByName}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDateTime(e.changedAt)}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
