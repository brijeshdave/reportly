// Author: Brijesh Dave <https://github.com/brijeshdave>
// One routine, for its owner: its cadence and assignees, plus a compliance grid over a
// window — each occurrence and, per assignee, whether they did it (and on time).
import {
  ROUTINE_CADENCE_LABELS,
  formatDate,
  type RoutineAssignee,
  type RoutineOccurrence,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { deleteRoutine, fetchRoutine, fetchRoutineOccurrences } from "@/services/routines.js";
import { Toolbar, ToolbarSelect, type SortDir } from "@/routes/routines/filters.js";
import { describeCadence, dayOffset } from "@/routes/routines/util.js";

/** Where one assignee stands on one occurrence — drives both the grid cell and filtering. */
type CellState = "completed" | "late" | "missed" | "pending";
const CELL_STATES: { value: CellState; label: string }[] = [
  { value: "completed", label: "On time" },
  { value: "late", label: "Late" },
  { value: "missed", label: "Missed" },
  { value: "pending", label: "Pending" },
];
const CELL_LABEL: Record<CellState, string> = {
  completed: "✓",
  late: "late",
  missed: "missed",
  pending: "—",
};
const CELL_TONE: Record<CellState, string> = {
  completed: "text-success",
  late: "text-warning",
  missed: "text-destructive",
  pending: "text-muted-foreground",
};

function cellState(o: RoutineOccurrence, userId: string): CellState {
  const c = o.completions.find((x) => x.userId === userId);
  if (c?.status === "completed") return c.onTime ? "completed" : "late";
  return o.date < dayOffset(0) ? "missed" : "pending";
}

export function RoutineDetailPage({ routineId }: { routineId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const routine = useQuery({
    queryKey: ["routines", "detail", routineId],
    queryFn: () => fetchRoutine(routineId),
  });
  const from = dayOffset(-30);
  const to = dayOffset(1);
  const occ = useQuery({
    queryKey: ["routine-occurrences", routineId, from, to],
    queryFn: () => fetchRoutineOccurrences(routineId, from, to),
  });

  const [assignee, setAssignee] = useState("all");
  const [status, setStatus] = useState<CellState | "all">("all");
  const [dir, setDir] = useState<SortDir>("desc");

  const visibleAssignees = useMemo(() => {
    const list = routine.data?.assignees ?? [];
    return assignee === "all" ? list : list.filter((a) => a.userId === assignee);
  }, [routine.data, assignee]);

  const rows = useMemo(() => {
    const list = (occ.data ?? []).filter(
      (o) => status === "all" || visibleAssignees.some((a) => cellState(o, a.userId) === status),
    );
    return list
      .slice()
      .sort((a, b) =>
        dir === "desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date),
      );
  }, [occ.data, visibleAssignees, status, dir]);

  const remove = useMutation({
    mutationFn: () => deleteRoutine(routineId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["routines"] });
      await navigate({ to: "/routines/manage" });
    },
  });

  if (routine.isLoading) return <Spinner />;
  if (routine.error) return <ErrorAlert error={routine.error} />;
  if (!routine.data) return null;
  const r = routine.data;

  return (
    <>
      <PageHeader
        title={r.title}
        description={`${ROUTINE_CADENCE_LABELS[r.cadence]} · ${describeCadence(r)} · ${r.points} pts`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigate({ to: "/routines/manage/$routineId/edit", params: { routineId } })
              }
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigate({ to: "/routines/manage" })}
            >
              Back
            </Button>
          </div>
        }
      />

      {r.status === "paused" ? <Badge tone="neutral">Paused</Badge> : null}

      <div className="pt-3">
        <h2 className="mb-2 text-sm font-semibold">Compliance — last 30 days</h2>
        {occ.isLoading ? (
          <Spinner />
        ) : occ.error ? (
          <ErrorAlert error={occ.error} />
        ) : (
          <>
            <Toolbar className="pb-3 pt-0">
              {r.assignees.length > 1 ? (
                <ToolbarSelect label="Assignee" value={assignee} onChange={setAssignee}>
                  <option value="all">Everyone</option>
                  {r.assignees.map((a) => (
                    <option key={a.userId} value={a.userId}>
                      {a.name}
                    </option>
                  ))}
                </ToolbarSelect>
              ) : null}
              <ToolbarSelect
                label="Status"
                value={status}
                onChange={(v) => setStatus(v as CellState | "all")}
              >
                <option value="all">All</option>
                {CELL_STATES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </ToolbarSelect>
              <ToolbarSelect label="Sort by" value={dir} onChange={(v) => setDir(v as SortDir)}>
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </ToolbarSelect>
            </Toolbar>
            <ComplianceGrid assignees={visibleAssignees} occurrences={rows} />
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${r.title}”?`}
        description="This removes the routine and its completion history. It cannot be undone."
        confirmLabel="Delete routine"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}

function ComplianceGrid({
  assignees,
  occurrences,
}: {
  assignees: RoutineAssignee[];
  occurrences: RoutineOccurrence[];
}) {
  if (occurrences.length === 0) {
    return <p className="text-sm text-muted-foreground">No occurrences match these filters.</p>;
  }
  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold">
              Day
            </th>
            {assignees.map((a) => (
              <th
                key={a.userId}
                className="border-b border-border px-3 py-2 text-left text-xs font-semibold"
              >
                {a.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {occurrences.map((o) => (
            <tr key={o.date}>
              <td className="border-b border-border px-3 py-1.5 whitespace-nowrap">
                {formatDate(`${o.date}T00:00:00`)}
              </td>
              {assignees.map((a) => {
                const st = cellState(o, a.userId);
                const notes = o.completions.find((x) => x.userId === a.userId)?.notes;
                return (
                  <td
                    key={a.userId}
                    className={cn("border-b border-border px-3 py-1.5 text-xs", CELL_TONE[st])}
                    title={notes ?? undefined}
                  >
                    {CELL_LABEL[st]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
