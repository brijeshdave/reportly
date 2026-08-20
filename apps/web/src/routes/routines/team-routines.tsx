// Author: Brijesh Dave <https://github.com/brijeshdave>
// The routines a manager owns for their team — create them, and open one to see who is
// keeping up. The compliance grid and the editor are their own pages.
//
// A table, like every other list in the app: the cards were pretty at a dozen
// routines and unusable at three hundred, and their four filters ran in the
// browser over whatever the one unpaged request happened to return. Filtering,
// sorting and paging now happen on the server, and the two filters a manager
// actually asks by — who does it, and where they work — are answered there too,
// because a routine belongs to a department and departments span sites.
import {
  PERMISSIONS,
  ROUTINE_CADENCES,
  ROUTINE_CADENCE_LABELS,
  type Routine,
} from "@reportly/shared";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Award, Building2, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { Alert } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDownline, fetchMyDepartments } from "@/services/departments.js";
import { fetchMyLocations } from "@/services/locations.js";
import { awardRoutineMonth } from "@/services/routines.js";
import { describeCadence } from "@/routes/routines/util.js";

const columns: TableColumn<Routine>[] = [
  {
    id: "title",
    accessorKey: "title",
    header: "Routine",
    cell: ({ row }) => (
      <Link
        to="/routines/manage/$routineId"
        params={{ routineId: row.original.id }}
        className="font-medium text-foreground hover:underline"
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    id: "cadence",
    accessorKey: "cadence",
    header: "Cadence",
    cell: ({ row }) => (
      <span className="text-sm">
        {ROUTINE_CADENCE_LABELS[row.original.cadence]}
        <span className="block text-xs text-muted-foreground">{describeCadence(row.original)}</span>
      </span>
    ),
  },
  {
    id: "departmentName",
    accessorKey: "departmentName",
    header: "Department",
    // The server sorts on the department's id, not its name, so offering a sort
    // here would order the rows by something nobody can see.
    enableSorting: false,
    cell: ({ row }) =>
      row.original.departmentName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "assignees",
    accessorKey: "assignees",
    header: "Who does it",
    enableSorting: false,
    cell: ({ row }) => {
      const names = row.original.assignees.map((a) => a.name);
      if (names.length === 0) return <span className="text-muted-foreground">Nobody</span>;
      return (
        <span className="text-sm" title={names.join(", ")}>
          {names.slice(0, 2).join(", ")}
          {names.length > 2 ? ` +${names.length - 2}` : ""}
        </span>
      );
    },
  },
  {
    id: "points",
    accessorKey: "points",
    header: "Points",
    cell: ({ row }) => <Badge tone="brand">{row.original.points} pts</Badge>,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge tone={row.original.status === "active" ? "success" : "neutral"}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: "startDate",
    accessorKey: "startDate",
    header: "Started",
    cell: ({ row }) => <span className="text-xs">{row.original.startDate}</span>,
  },
];

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
  const list = useListResource<Routine>({
    resource: "routines-managed",
    path: "/routines/managed",
    initial: { sortBy: "title" },
  });

  // The three option lists come from the caller's own view of the org — their
  // departments, their downline, their sites — so a manager without
  // `departments:read` or `locations:read` still gets working filters.
  const myDepartments = useQuery({
    queryKey: ["users", "departments", session.user.id],
    queryFn: () => fetchMyDepartments(),
  });
  const downline = useQuery({
    queryKey: ["users", "downline", session.user.id],
    queryFn: () => fetchDownline(session.user.id),
  });
  const myLocations = useQuery({ queryKey: ["me", "locations"], queryFn: fetchMyLocations });

  const filterDefs = useMemo<FilterDef[]>(
    () => [
      { field: "title", label: "Title", kind: "text" },
      {
        field: "departmentId",
        label: "Department",
        kind: "combobox",
        options: departmentOptions(
          (myDepartments.data ?? [])
            .filter((d) => d.companyId === session.companyId)
            .map((d) => ({ value: d.departmentId, name: d.name, path: d.path })),
        ),
      },
      {
        field: "cadence",
        label: "Cadence",
        kind: "select",
        options: ROUTINE_CADENCES.map((c) => ({ value: c, label: ROUTINE_CADENCE_LABELS[c] })),
      },
      {
        field: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "paused", label: "Paused" },
        ],
      },
      {
        // Not a column on the routine: it keeps the ones somebody in this list is
        // assigned to. Only the caller's downline is offered, which is the same
        // set they may assign to in the first place.
        field: "assigneeId",
        label: "Assigned to",
        kind: "combobox",
        options: [...new Map((downline.data ?? []).map((m) => [m.userId, m])).values()].map(
          (m) => ({ value: m.userId, label: m.name, hint: m.departmentName }),
        ),
      },
      {
        // Also not a column: a routine has no site. This keeps the routines whose
        // people work at that one.
        field: "locationId",
        label: "Site (of whoever does it)",
        kind: "combobox",
        options: (myLocations.data ?? []).map((l) => ({ value: l.id, label: l.name })),
      },
      { field: "points", label: "Points at least", kind: "number", op: "gte" },
    ],
    [myDepartments.data, downline.data, myLocations.data, session.companyId],
  );

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
            <Can permission={PERMISSIONS.ROUTINES_MANAGE}>
              <Button size="sm" onClick={() => void navigate({ to: "/routines/manage/new" })}>
                <Plus className="h-4 w-4" />
                New routine
              </Button>
            </Can>
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

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        // Started is detail rather than headline: it settles an argument about
        // when a duty began, and crowds the table the rest of the time.
        initialColumnVisibility={{ startDate: false }}
        emptyTitle="No routines yet"
        emptyDescription="Create a recurring duty for your team."
        renderCard={(routine) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Link
                to="/routines/manage/$routineId"
                params={{ routineId: routine.id }}
                className="block truncate text-sm font-medium hover:underline"
              >
                {routine.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {ROUTINE_CADENCE_LABELS[routine.cadence]} · {routine.assignees.length}{" "}
                {routine.assignees.length === 1 ? "person" : "people"}
              </span>
            </div>
            <Badge tone="brand">{routine.points} pts</Badge>
          </div>
        )}
      />
    </>
  );
}
