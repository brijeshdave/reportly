// Author: Brijesh Dave <https://github.com/brijeshdave>
// Moving a report along, from the report itself.
//
// Keeping a status current is the single most frequent thing anybody does to a
// report, and it used to mean opening the edit form, changing one dropdown and
// saving. That is enough friction that statuses stop being kept up to date — and
// once they are stale, every figure derived from them (response time, resolution
// time, what is still open) is quietly wrong.
//
// Only the moves the API will accept are offered. The rule comes from each status's
// own group/terminal flags rather than a hard-coded map, so it stays correct for
// statuses an administrator adds later:
//   - freely among the open states
//   - from any open state to any finished one
//   - from finished back to open — a re-open
//   - never finished straight to finished
import type { JournalEntry, JournalStatus } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Select, Spinner } from "@/components/ui/form.js";
import { Badge, Button } from "@/components/ui/primitives.js";
import { statusTone } from "@/components/report-badges.js";
import { changeReportStatus } from "@/services/journal.js";
import { fetchStatuses } from "@/services/journal-config.js";

export function StatusControl({ report, canDrive }: { report: JournalEntry; canDrive: boolean }) {
  const queryClient = useQueryClient();
  const statuses = useQuery({ queryKey: ["report-config", "statuses"], queryFn: fetchStatuses });

  const change = useMutation({
    mutationFn: (statusId: string | null) => changeReportStatus(report.id, statusId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reports", "detail", report.id] });
      // The timeline gains an entry, and the list shows the new status.
      await queryClient.invalidateQueries({ queryKey: ["reports", report.id, "timeline"] });
      await queryClient.invalidateQueries({ queryKey: ["reports", "list"] });
    },
  });

  // The choice is staged locally and applied on Save, not fired the instant the
  // dropdown changes: a status move is a real event on the timeline, and picking one
  // by mistake should not commit it. The staged value re-syncs whenever the report's
  // actual status changes underneath it (a save landing, or somebody else moving it).
  const [choice, setChoice] = useState<string>(report.statusId ?? "");
  useEffect(() => {
    setChoice(report.statusId ?? "");
  }, [report.statusId]);

  const all = (statuses.data ?? []).filter((s) => s.status === "active");
  const current = all.find((s) => s.id === report.statusId) ?? null;

  // Somebody who cannot move it still sees where it is.
  if (!canDrive) {
    return current ? (
      <Badge tone={statusTone(current.group)}>{current.name}</Badge>
    ) : (
      <Badge tone="neutral">—</Badge>
    );
  }

  const offered = all.filter((s) => isLegalMove(current, s));
  const dirty = choice !== (report.statusId ?? "");

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Select
          aria-label="Status"
          value={choice}
          disabled={change.isPending || statuses.isLoading}
          onChange={(event) => setChoice(event.target.value)}
          className="w-48"
        >
          {/* The current status is always listed, even when the rules would not
              allow moving *to* it — otherwise the control would show something
              other than where the report actually is. */}
          {current ? <option value={current.id}>{current.name}</option> : null}
          {offered
            .filter((s) => s.id !== current?.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {current?.isTerminal && !s.isTerminal ? " (re-open)" : ""}
              </option>
            ))}
        </Select>
        <Button
          size="sm"
          onClick={() => {
            // Never null: the picker does not offer "no status", so an empty value
            // could only be the placeholder, which is not a move.
            if (dirty && choice) change.mutate(choice);
          }}
          disabled={!dirty || change.isPending || !choice}
        >
          {change.isPending ? <Spinner /> : null}
          Save
        </Button>
      </div>

      {current?.isTerminal && !dirty ? (
        <p className="text-xs text-muted-foreground">
          Finished as {current.name}. To mark it differently, re-open it first — the record then
          shows both.
        </p>
      ) : null}

      {change.error ? <ErrorAlert error={change.error} /> : null}
    </div>
  );
}

/**
 * Would the API accept this move? Mirrors the server rule exactly — the server is
 * still the one enforcing it; this only avoids offering a choice that would be
 * refused a moment later.
 */
function isLegalMove(from: JournalStatus | null, to: JournalStatus): boolean {
  if (!from) return true; // no status yet: anything is a start
  if (from.id === to.id) return false;
  // Finished to finished loses the fact that it was ever finished the first way.
  return !(from.isTerminal && to.isTerminal);
}
