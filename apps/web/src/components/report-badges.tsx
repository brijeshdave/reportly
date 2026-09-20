// Author: Brijesh Dave <https://github.com/brijeshdave>
// The badges a report shows — kind, status and state — in one place, so the same
// label looks the same everywhere it appears: the list, the detail, My day.
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/primitives.js";
import { fetchSeverities } from "@/services/journal-config.js";

import type { TaskPriority } from "@reportly/shared";

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

/**
 * A task's priority, coloured by how much it is claiming.
 *
 * Asked for from use: "Severity should have also some badges in different color. and
 * also for the task priority." A priority printed as the plain word "urgent" in a
 * column of plain words is a sort key nobody reads; the point of the field is to be
 * seen without being looked for.
 *
 * Low is deliberately the quietest of the four rather than a fifth colour: the eye
 * should be pulled by what is urgent, not by a full rainbow where every row shouts.
 */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const tone =
    priority === "urgent"
      ? "danger"
      : priority === "high"
        ? "warning"
        : priority === "low"
          ? "neutral"
          : "info";
  return (
    <Badge tone={tone} className="capitalize">
      {priority}
    </Badge>
  );
}

/**
 * How severe an entry is, coloured by where that severity sits in the ladder.
 *
 * Colour comes from the *order*, not from the name: the severities are an
 * installation's own vocabulary — "Minor / Major / Critical" on one site, four
 * levels with different words on another — so a lookup by name would be a list this
 * file could only ever get wrong. The ladder already says which end is worse.
 *
 * The bottom of the ladder is quiet, the top is red, and everything between takes
 * the middle two tones. One severity on its own is neutral: with nothing to compare
 * it to, colouring it red would be an opinion the data does not support.
 */
export function SeverityBadge({ name }: { name: string | null }) {
  const { data } = useQuery({ queryKey: ["severities"], queryFn: fetchSeverities });
  if (!name) return <span className="text-muted-foreground">—</span>;

  const ladder = [...(data ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);
  const index = ladder.findIndex((s) => s.name === name);
  // Before the catalogue arrives, or for a severity no longer in it, the badge still
  // has to say the word — a missing colour is a smaller fault than a missing label.
  if (index < 0 || ladder.length < 2) return <Badge tone="neutral">{name}</Badge>;

  const share = index / (ladder.length - 1);
  const tone =
    share >= 1 ? "danger" : share >= 0.66 ? "warning" : share >= 0.33 ? "info" : "success";
  return <Badge tone={tone}>{name}</Badge>;
}
