// Author: Brijesh Dave <https://github.com/brijeshdave>
// The routines assigned to you, each leading with the duty itself and then its schedule
// of occurrences — status, the times you did it, how long it took, and the points it
// earned. A routine is logged after the fact, so you enter the start/finish times; a
// finished one can be re-opened, and an expired one can no longer be logged.
import {
  ROUTINE_CADENCE_LABELS,
  ROUTINE_OCCURRENCE_STATES,
  formatDate,
  formatDateTime,
  formatDurationMinutes,
  type Routine,
  type RoutineCompletion,
  type RoutineOccurrence,
  type RoutineOccurrenceState,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, ListChecks, Paperclip, Pencil } from "lucide-react";
import { useMemo, useState } from "react";

import { AttachmentsPanel } from "@/components/attachments-panel.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Field, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import {
  fetchAssignedRoutines,
  fetchMyOccurrences,
  finishOccurrence,
} from "@/services/routines.js";
import { Toolbar, ToolbarSelect, type SortDir } from "@/routes/routines/filters.js";
import { STATE_LABEL, STATE_TONE, describeCadence, dayOffset } from "@/routes/routines/util.js";

/** ISO instant → the value a <input type="datetime-local"> expects, in local time. */
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const round2 = (n: number) => Math.round(n * 2) / 2;

export function MyRoutinesPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const from = dayOffset(-21);
  const to = dayOffset(8);
  const occ = useQuery({
    queryKey: ["routine-occurrences", "mine", from, to],
    queryFn: () => fetchMyOccurrences(from, to),
  });
  const routines = useQuery({ queryKey: ["routines", "assigned"], queryFn: fetchAssignedRoutines });
  const all = occ.data ?? [];
  const routineById = useMemo(
    () => new Map((routines.data ?? []).map((r) => [r.id, r])),
    [routines.data],
  );

  const [routine, setRoutine] = useState("all");
  const [state, setState] = useState<RoutineOccurrenceState | "all">("all");
  const [dir, setDir] = useState<SortDir>("desc");

  // The routines you have occurrences of, to filter by.
  const routineOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of all) if (!seen.has(o.routineId)) seen.set(o.routineId, o.routineTitle);
    return [...seen]
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [all]);

  // Filter, then gather by routine; each group's occurrences sorted by date.
  const groups = useMemo(() => {
    const filtered = all.filter(
      (o) =>
        (routine === "all" || o.routineId === routine) && (state === "all" || o.state === state),
    );
    const byRoutine = new Map<
      string,
      { title: string; points: number; rows: RoutineOccurrence[] }
    >();
    for (const o of filtered) {
      const g = byRoutine.get(o.routineId) ?? { title: o.routineTitle, points: o.points, rows: [] };
      g.rows.push(o);
      byRoutine.set(o.routineId, g);
    }
    const out = [...byRoutine].map(([id, g]) => ({
      id,
      ...g,
      rows: g.rows.sort((a, b) =>
        dir === "desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date),
      ),
    }));
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }, [all, routine, state, dir]);

  const loading = occ.isLoading || routines.isLoading;

  // Company-scoped: these endpoints answer 400 without the header rather than
  // returning nothing, so with "All companies" chosen the page showed a
  // reference id where an instruction belonged.
  if (!session.companyId) {
    return (
      <>
        <PageHeader title="My routines" />
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher. Routines belong to a company's departments, so there is nothing due until one is chosen."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My routines"
        description="The recurring duties assigned to you. Log each with the times you actually did it — on time earns points at month-end."
      />
      {loading ? (
        <Spinner />
      ) : occ.error ? (
        <ErrorAlert error={occ.error} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No routines"
          description="Nothing is assigned to you in this window."
        />
      ) : (
        <>
          <Toolbar>
            <ToolbarSelect label="Routine" value={routine} onChange={setRoutine}>
              <option value="all">All routines</option>
              {routineOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </ToolbarSelect>
            <ToolbarSelect
              label="Status"
              value={state}
              onChange={(v) => setState(v as RoutineOccurrenceState | "all")}
            >
              <option value="all">All</option>
              {ROUTINE_OCCURRENCE_STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </ToolbarSelect>
            <ToolbarSelect label="Sort by" value={dir} onChange={(v) => setDir(v as SortDir)}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </ToolbarSelect>
          </Toolbar>
          {groups.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No matches"
              description="No occurrences match these filters."
            />
          ) : (
            <div className="flex flex-col gap-4 pt-3">
              {groups.map((g) => (
                <RoutineSection
                  key={g.id}
                  title={g.title}
                  points={g.points}
                  routine={routineById.get(g.id)}
                  occurrences={g.rows}
                  meId={session.user.id}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function RoutineSection({
  title,
  points,
  routine,
  occurrences,
  meId,
}: {
  title: string;
  points: number;
  routine?: Routine;
  occurrences: RoutineOccurrence[];
  meId: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{title}</span>
            <Badge tone="brand">{points} pts</Badge>
          </div>
          {routine ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {ROUTINE_CADENCE_LABELS[routine.cadence]} · {describeCadence(routine)}
              {routine.departmentName ? ` · ${routine.departmentName}` : ""}
            </p>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {occurrences.length} {occurrences.length === 1 ? "schedule" : "schedules"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2 font-medium">Finished</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Points</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {occurrences.map((o) => (
              <OccurrenceRow key={o.date} occ={o} meId={meId} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function OccurrenceRow({ occ, meId }: { occ: RoutineOccurrence; meId: string }) {
  const queryClient = useQueryClient();
  const mine: RoutineCompletion | undefined = occ.completions.find((c) => c.userId === meId);
  const done = mine?.status === "completed";

  const [editing, setEditing] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [started, setStarted] = useState("");
  const [finished, setFinished] = useState("");
  const [notes, setNotes] = useState("");

  const openForm = () => {
    setStarted(toLocalInput(mine?.startedAt ?? null));
    setFinished(toLocalInput(mine?.finishedAt ?? null));
    setNotes(mine?.notes ?? "");
    setEditing(true);
  };

  const log = useMutation({
    mutationFn: () =>
      finishOccurrence(occ.routineId, occ.date, {
        startedAt: started ? new Date(started).toISOString() : undefined,
        finishedAt: new Date(finished).toISOString(),
        notes: notes || undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["routine-occurrences"] });
      setEditing(false);
    },
  });

  const durationMinutes =
    mine?.startedAt && mine?.finishedAt
      ? (new Date(mine.finishedAt).getTime() - new Date(mine.startedAt).getTime()) / 60000
      : null;

  // Awarded once the month is run; before that, the provisional on-time/half value.
  const pointsCell = (() => {
    if (mine?.awardedPoints != null)
      return <span className="text-success">{mine.awardedPoints}</span>;
    if (done) {
      const provisional = round2(mine!.onTime ? occ.points : occ.points / 2);
      return (
        <span className="text-muted-foreground">
          {provisional} <span className="text-[10px]">pending</span>
        </span>
      );
    }
    return <span className="text-muted-foreground">—</span>;
  })();

  return (
    <>
      <tr className="border-t border-border">
        <td className="whitespace-nowrap px-4 py-2">{formatDate(`${occ.date}T00:00:00`)}</td>
        <td className="px-3 py-2">
          <Badge tone={STATE_TONE[occ.state]}>{STATE_LABEL[occ.state]}</Badge>
          {occ.locked && !done ? (
            <span className="ml-1 text-[10px] text-muted-foreground">expired</span>
          ) : null}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
          {mine?.startedAt ? formatDateTime(mine.startedAt) : "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
          {mine?.finishedAt ? formatDateTime(mine.finishedAt) : "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
          {formatDurationMinutes(durationMinutes)}
        </td>
        <td className="whitespace-nowrap px-3 py-2">{pointsCell}</td>
        <td className="px-4 py-2">
          <div className="flex items-center justify-end gap-1.5">
            {mine ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowFiles((s) => !s)}
                aria-label="Files"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={done ? "secondary" : "primary"}
              disabled={occ.locked}
              onClick={openForm}
            >
              {done ? <Pencil className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {done ? "Edit" : "Log"}
            </Button>
          </div>
        </td>
      </tr>
      {editing || (showFiles && mine) ? (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={7} className="px-4 py-3">
            {editing ? (
              <div className="flex flex-col gap-2">
                {log.error ? <ErrorAlert error={log.error} /> : null}
                <div className="flex flex-wrap gap-3">
                  <div className="min-w-[13rem] flex-1">
                    <Field label="Started">
                      {(props) => (
                        <input
                          {...props}
                          type="datetime-local"
                          value={started}
                          onChange={(e) => setStarted(e.target.value)}
                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                        />
                      )}
                    </Field>
                  </div>
                  <div className="min-w-[13rem] flex-1">
                    <Field label="Finished">
                      {(props) => (
                        <input
                          {...props}
                          type="datetime-local"
                          value={finished}
                          onChange={(e) => setFinished(e.target.value)}
                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                        />
                      )}
                    </Field>
                  </div>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Notes (optional)"
                  className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={!finished || log.isPending}
                    onClick={() => log.mutate()}
                  >
                    Save log
                  </Button>
                </div>
              </div>
            ) : showFiles && mine ? (
              <AttachmentsPanel
                ownerType="routine-completion"
                ownerId={mine.id}
                canWrite
                locked={false}
              />
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
