// Author: Brijesh Dave <https://github.com/brijeshdave>
// The points-change history for one report: every time someone's points were set,
// cleared, or the person was dropped — who did it, when, and old → new. Read-only, and
// only rendered for a caller who may see the review tier (blind upward), so it never
// discloses a review hidden from the worker below.
import { type ScoreEvent, formatDateTime } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Card, EmptyState } from "@/components/ui/primitives.js";
import { History } from "lucide-react";
import { fetchScoreEvents } from "@/services/journal.js";

const REASON_LABEL: Record<ScoreEvent["reason"], string> = {
  score: "Scored",
  reopened: "Cleared (re-opened)",
  rejected: "Cleared (rejected)",
  removed: "Removed from report",
  "status-change": "Status changed — re-check",
};

const REASON_TONE: Record<ScoreEvent["reason"], "success" | "warning" | "danger" | "neutral"> = {
  score: "success",
  reopened: "warning",
  rejected: "danger",
  removed: "neutral",
  "status-change": "warning",
};

const fmt = (n: number | null) =>
  n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1);

export function PointsHistoryTab({ reportId }: { reportId: string }) {
  const events = useQuery({
    queryKey: ["reports", "score-events", reportId],
    queryFn: () => fetchScoreEvents(reportId),
  });

  if (events.isLoading) return <Spinner />;
  if (events.error) return <ErrorAlert error={events.error} />;
  const rows = events.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No points changes yet"
        description="Points changes will appear here as they happen."
      />
    );
  }

  return (
    <Card className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Change</th>
            <th className="px-3 py-2 font-medium">Person</th>
            <th className="px-3 py-2 font-medium">Tier</th>
            <th className="px-3 py-2 font-medium">Points</th>
            <th className="px-4 py-2 font-medium">By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-t border-border">
              <td className="whitespace-nowrap px-4 py-1.5 text-muted-foreground">
                {formatDateTime(e.createdAt)}
              </td>
              <td className="px-3 py-1.5">
                <Badge tone={REASON_TONE[e.reason]}>{REASON_LABEL[e.reason]}</Badge>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">{e.subjectName ?? "—"}</td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {e.tier === "review" ? "Review" : "Self"}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                {fmt(e.oldPoints)} <span className="text-muted-foreground">→</span>{" "}
                {fmt(e.newPoints)}
              </td>
              <td className="whitespace-nowrap px-4 py-1.5 text-muted-foreground">
                {e.raterName ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
