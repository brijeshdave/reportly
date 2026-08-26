// Author: Brijesh Dave <https://github.com/brijeshdave>
// The badges a report shows — kind, status and state — in one place, so the same
// label looks the same everywhere it appears: the list, the detail, My day.
import { Badge } from "@/components/ui/primitives.js";

/** The badge tone that matches what a status group means. */
export function statusTone(group: string | null): "neutral" | "brand" | "success" | "danger" {
  if (group === "resolved") return "success";
  if (group === "rejected") return "danger";
  if (group === "open") return "brand";
  return "neutral";
}

/** A report's status, coloured by its group. A dash when it has none. */
export function StatusBadge({ name, group }: { name: string | null; group: string | null }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return <Badge tone={statusTone(group)}>{name}</Badge>;
}

/**
 * A breakdown, or work that was planned.
 *
 * The second kind used to be called "Work log", which collided with the work-log
 * timeline every entry has: people filing ordinary work ended up with entries
 * labelled Kind: WorkLog without meaning to. It is "Planned work" now, and off by
 * default — most installations file everything as an entry and record the work on
 * it.
 *
 * A breakdown carries the brand colour, being a problem to solve; planned work
 * takes the soft blue, a calm accent visible in both themes without competing.
 */
export function KindBadge({ kind }: { kind: string }) {
  return kind === "issue" ? (
    <Badge tone="brand">Issue</Badge>
  ) : (
    <Badge tone="info">Planned work</Badge>
  );
}

/** Draft vs submitted. A draft is the one that wants attention. */
export function StateBadge({ state }: { state: string }) {
  return state === "draft" ? (
    <Badge tone="warning">Draft</Badge>
  ) : (
    <Badge tone="outline">Submitted</Badge>
  );
}
