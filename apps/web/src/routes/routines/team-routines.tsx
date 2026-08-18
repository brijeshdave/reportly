// Author: Brijesh Dave <https://github.com/brijeshdave>
// The routines a manager owns for their team — create them, and open one to see who is
// keeping up. The compliance grid and the editor are their own pages.
import {
  ROUTINE_CADENCES,
  ROUTINE_CADENCE_LABELS,
  type Routine,
  type RoutineCadence,
} from "@reportly/shared";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Award, Building2, ListChecks, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { awardRoutineMonth, fetchManagedRoutines } from "@/services/routines.js";
import { Toolbar, ToolbarSearch, ToolbarSelect } from "@/routes/routines/filters.js";
import { describeCadence } from "@/routes/routines/util.js";

type StatusFilter = "all" | "active" | "paused";
type SortKey = "title" | "points" | "people" | "cadence";

const SORT_LABELS: Record<SortKey, string> = {
  title: "Title (A–Z)",
  points: "Points (high–low)",
  people: "People (most)",
  cadence: "Cadence",
};

/** The month that just closed, as the "YYYY-MM" an <input type="month"> holds. */
function lastMonthValue(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "July 2026" for a "YYYY-MM" value. */
function monthName(value: string): string {
  return new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function TeamRoutinesPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const navigate = useNavigate();
  const routines = useQuery({ queryKey: ["routines", "managed"], queryFn: fetchManagedRoutines });
  const all = routines.data ?? [];

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [cadence, setCadence] = useState<RoutineCadence | "all">("all");
  const [department, setDepartment] = useState("all");
  const [sort, setSort] = useState<SortKey>("title");

  // Departments to filter by come from the routines themselves.
  const departments = useMemo(
    () =>
      [...new Set(all.map((r) => r.departmentName).filter((n): n is string => Boolean(n)))].sort(),
    [all],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = all.filter(
      (r) =>
        (q === "" || r.title.toLowerCase().includes(q)) &&
        (status === "all" || r.status === status) &&
        (cadence === "all" || r.cadence === cadence) &&
        (department === "all" || r.departmentName === department),
    );
    const cadenceOrder = (c: RoutineCadence) => ROUTINE_CADENCES.indexOf(c);
    return filtered.sort((a, b) => {
      switch (sort) {
        case "points":
          return b.points - a.points || a.title.localeCompare(b.title);
        case "people":
          return b.assignees.length - a.assignees.length || a.title.localeCompare(b.title);
        case "cadence":
          return (
            cadenceOrder(a.cadence) - cadenceOrder(b.cadence) || a.title.localeCompare(b.title)
          );
        default:
          return a.title.localeCompare(b.title);
      }
    });
  }, [all, search, status, cadence, department, sort]);

  // The award runs automatically on the 2nd of each month; this is the manual re-run,
  // defaulting to the month that just closed.
  const [awardMonth, setAwardMonth] = useState(lastMonthValue);
  const award = useMutation({
    mutationFn: () => {
      const [y, m] = awardMonth.split("-").map(Number);
      return awardRoutineMonth(y!, m!);
    },
  });

  // Company-scoped: these endpoints answer 400 without the header rather than
  // returning nothing, so with "All companies" chosen the page showed a
  // reference id where an instruction belonged.
  if (!session.companyId) {
    return (
      <>
        <PageHeader title="Team routines" />
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher. Routines belong to a company's departments."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team routines"
        description="Recurring duties you give your team. Open one to see who is keeping up; points for on-time completions are added automatically on the 2nd of each month."
        actions={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={awardMonth}
              max={lastMonthValue()}
              onChange={(e) => setAwardMonth(e.target.value)}
              aria-label="Month to award"
              className="h-9 rounded-xl border border-border bg-background px-2 text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={award.isPending}
              onClick={() => award.mutate()}
            >
              <Award className="h-4 w-4" />
              Award
            </Button>
            <Button size="sm" onClick={() => void navigate({ to: "/routines/manage/new" })}>
              <Plus className="h-4 w-4" />
              New routine
            </Button>
          </div>
        }
      />
      {award.error ? <ErrorAlert error={award.error} /> : null}
      {award.isSuccess ? (
        <Alert tone="success">
          Awarded {award.data.points} points across {award.data.count}{" "}
          {award.data.count === 1 ? "completion" : "completions"} for {monthName(awardMonth)}. They
          now count on the leaderboard.
        </Alert>
      ) : null}
      {routines.isLoading ? (
        <Spinner />
      ) : routines.error ? (
        <ErrorAlert error={routines.error} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No routines yet"
          description="Create a recurring duty for your team."
        />
      ) : (
        <>
          <Toolbar>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Filter by title…" />
            <ToolbarSelect
              label="Status"
              value={status}
              onChange={(v) => setStatus(v as StatusFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </ToolbarSelect>
            <ToolbarSelect
              label="Cadence"
              value={cadence}
              onChange={(v) => setCadence(v as RoutineCadence | "all")}
            >
              <option value="all">All</option>
              {ROUTINE_CADENCES.map((c) => (
                <option key={c} value={c}>
                  {ROUTINE_CADENCE_LABELS[c]}
                </option>
              ))}
            </ToolbarSelect>
            {departments.length > 0 ? (
              <ToolbarSelect label="Department" value={department} onChange={setDepartment}>
                <option value="all">All</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </ToolbarSelect>
            ) : null}
            <ToolbarSelect label="Sort by" value={sort} onChange={(v) => setSort(v as SortKey)}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </ToolbarSelect>
          </Toolbar>
          {rows.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No matches"
              description="No routines match these filters."
            />
          ) : (
            <div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <RoutineCard key={r.id} routine={r} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function RoutineCard({ routine }: { routine: Routine }) {
  return (
    <Card className="group relative flex cursor-pointer flex-col gap-1.5 p-4 transition hover:border-primary/50 hover:shadow-sm">
      <Link
        to="/routines/manage/$routineId"
        params={{ routineId: routine.id }}
        className="absolute inset-0 rounded-xl"
        aria-label={routine.title}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{routine.title}</span>
        {routine.status === "paused" ? <Badge tone="neutral">Paused</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {ROUTINE_CADENCE_LABELS[routine.cadence]} · {describeCadence(routine)}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge tone="brand">{routine.points} pts</Badge>
        <span>
          {routine.assignees.length} {routine.assignees.length === 1 ? "person" : "people"}
        </span>
        {routine.departmentName ? <span>· {routine.departmentName}</span> : null}
      </div>
    </Card>
  );
}
