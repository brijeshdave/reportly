// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tasks — what you have been asked to do, and what you have asked of others.
//
// The list is filtered to open work by default. A task list that opens on everything
// ever finished buries the two jobs due today under a year of completed ones.
import { PERMISSIONS, UNASSIGNED, type TaskRow, formatDate } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo } from "react";

import { usePermission } from "@/components/can.js";
import { PriorityBadge } from "@/components/report-badges.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { Badge, Button, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { taskViewFilters, type TaskView } from "@/lib/list-views.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchOrgPeople } from "@/services/departments.js";
import { fetchLocations } from "@/services/locations.js";

const STATE_TONE = {
  open: "neutral",
  in_progress: "brand",
  done: "success",
  cancelled: "neutral",
} as const;

const STATE_LABEL = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
} as const;

/** "Overdue", "Today", or the date — a date alone makes you do the arithmetic. */
function dueLabel(dueAt: string | null): { text: string; overdue: boolean } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const now = new Date();
  const sameDay = due.toDateString() === now.toDateString();
  if (sameDay) return { text: "Today", overdue: false };
  if (due < now) return { text: `Overdue — ${formatDate(due)}`, overdue: true };
  return { text: formatDate(due), overdue: false };
}

const columns: TableColumn<TaskRow>[] = [
  {
    id: "title",
    accessorKey: "title",
    header: "Task",
    // A sentence, not a token: this one may take a second line rather than
    // making the column as wide as the longest entry anybody ever filed.
    wrap: true,
    cell: ({ row }) => (
      <Link
        to="/tasks/$taskId"
        params={{ taskId: row.original.id }}
        className="font-medium text-foreground hover:underline"
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    id: "assigneeName",
    header: "Assigned to",
    // Not sortable: it is a list of people, not a value, and there is no column on
    // the task to sort it by. Somebody released is greyed rather than dropped —
    // they worked on it, and the points will be split with them.
    enableSorting: false,
    cell: ({ row }) => {
      const people = row.original.assignees;
      if (people.length === 0) {
        return <span className="text-muted-foreground">Not assigned yet</span>;
      }
      return (
        <span className="flex flex-wrap gap-x-1">
          {people.map((person, i) => (
            <span
              key={person.id}
              className={person.released ? "text-muted-foreground line-through" : undefined}
            >
              {person.name}
              {i < people.length - 1 ? "," : ""}
            </span>
          ))}
        </span>
      );
    },
  },
  {
    id: "assignerName",
    accessorKey: "assignerName",
    header: "Assigned by",
    // Not sortable: the server sorts by the task's own columns, and an unknown sort
    // silently falls back to the default order — a header that looks clickable and
    // does nothing. Filter by "Raised by" instead. Not added to the server's list
    // either, because a joined name there is the shape that made the journal's
    // severity filter 500.
    enableSorting: false,
  },
  {
    id: "priority",
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
  },
  {
    id: "state",
    accessorKey: "state",
    header: "State",
    cell: ({ row }) => (
      <Badge tone={STATE_TONE[row.original.state]}>{STATE_LABEL[row.original.state]}</Badge>
    ),
  },
  {
    id: "dueAt",
    accessorKey: "dueAt",
    header: "Due",
    cell: ({ row }) => {
      const due = dueLabel(row.original.dueAt);
      if (!due) return <span className="text-muted-foreground">—</span>;
      return <span className={due.overdue ? "text-danger" : undefined}>{due.text}</span>;
    },
  },
  {
    // What the task is worth — the ceiling of the entry filed against it.
    id: "maxPoints",
    accessorKey: "maxPoints",
    header: "Worth",
    cell: ({ row }) => `${row.original.maxPoints} pts`,
  },
  {
    // The site the work is for. Shown by default, not tucked behind the Columns
    // menu: "in journal or task or any place need location or site to be shown in
    // table column always". Not sortable — the server sorts tasks by their own
    // columns, and the name comes from a join.
    id: "locationName",
    accessorKey: "locationName",
    header: "Site",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.locationName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "departmentName",
    accessorKey: "departmentName",
    header: "Department",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.departmentName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Raised",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
  {
    id: "completedAt",
    accessorKey: "completedAt",
    header: "Completed",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.completedAt ? (
        formatDate(row.original.completedAt)
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

// Every column is one tick away in the Columns menu; these start hidden so the
// default table stays the four things a task list is opened to read.
const initialColumnVisibility = {
  departmentName: false,
  createdAt: false,
  completedAt: false,
};

export function TasksListPage() {
  const navigate = useNavigate();
  const people = useQuery({ queryKey: ["org", "people"], queryFn: fetchOrgPeople });
  const sites = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const { data: session } = useQuery(sessionQuery);
  const me = session?.user;
  const filterDefs = useMemo<FilterDef[]>(
    () => [
      { field: "title", label: "Task", kind: "text" },
      {
        field: "state",
        label: "State",
        kind: "select",
        options: [
          { value: "open", label: "Open" },
          { value: "in_progress", label: "In progress" },
          { value: "done", label: "Done" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      {
        field: "priority",
        label: "Priority",
        kind: "select",
        options: [
          { value: "low", label: "Low" },
          { value: "normal", label: "Normal" },
          { value: "high", label: "High" },
          { value: "urgent", label: "Urgent" },
        ],
      },
      {
        field: "assigneeId",
        label: "Assignee",
        kind: "combobox",
        options: [
          // Planned-ahead work is the reason people open this filter: it is how you
          // find the tasks waiting to be handed out.
          { value: UNASSIGNED, label: "Not assigned yet" },
          ...(people.data ?? []).map((p) => ({
            value: p.userId,
            label: p.name,
            hint: p.departmentNames.join(", ") || undefined,
          })),
        ],
      },
      {
        // "If tasks need to see it was created by himself or manager." A person's own
        // planned work and the work handed to them are different questions, so the
        // first option is the one-click answer to the commoner of the two.
        field: "assignerId",
        label: "Raised by",
        kind: "combobox",
        options: [
          ...(me ? [{ value: me.id, label: "Me" }] : []),
          ...(people.data ?? [])
            .filter((p) => p.userId !== me?.id)
            .map((p) => ({
              value: p.userId,
              label: p.name,
              hint: p.departmentNames.join(", ") || undefined,
            })),
        ],
      },
      {
        field: "locationId",
        label: "Site",
        kind: "combobox",
        options: (sites.data ?? []).map((l) => ({ value: l.id, label: l.name })),
      },
      { field: "dueAt", label: "Due", kind: "daterange" },
      { field: "createdAt", label: "Raised", kind: "daterange" },
    ],
    [people.data, me, sites.data],
  );
  // A Reviews "Read all" link opens this on a named view. Read from the URL here
  // rather than passed down, so the route can stay lazily loaded.
  const { view } = useSearch({ strict: false }) as { view?: TaskView };
  const linked = view && me ? taskViewFilters(view, me.id) : null;

  const list = useListResource<TaskRow>({
    // Its own slot for a linked view, so the link neither inherits the ordinary
    // list's filters nor overwrites them. The columns still follow "tasks".
    resource: linked ? `tasks:view:${view}` : "tasks",
    path: "/tasks",
    // Soonest deadline first, and open work only — the two questions a task list is
    // opened to answer. Both are ordinary filters, so they clear like any other.
    initial: {
      sortBy: "dueAt",
      sortDir: "asc",
      filters: linked ?? [{ field: "state", op: "in", value: ["open", "in_progress"] }],
    },
    // A linked view names "me", so it waits until it knows who that is rather than
    // briefly listing everything and then jumping.
    enabled: !view || Boolean(me),
  });

  const mayAssign = usePermission(PERMISSIONS.TASKS_CREATE);
  const mayCreateOwn = usePermission(PERMISSIONS.TASKS_CREATE_OWN);

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work you have been asked to do, and work you have asked of others. Completing a task opens a report pre-filled from it, so the work still gets logged."
        actions={
          // Two grants reach this screen, and they mean different things: a manager
          // assigns work, a member gives themselves work and cannot hand it to
          // anybody. The button says which one this is, rather than one wording
          // that is wrong for half the people reading it.
          mayAssign || mayCreateOwn ? (
            <Button size="sm" onClick={() => void navigate({ to: "/tasks/new" })}>
              <Plus className="h-4 w-4" />
              {mayAssign ? "Assign a task" : "New task"}
            </Button>
          ) : null
        }
      />

      <div className="pt-4">
        <DataTable
          {...list}
          columns={columns}
          filterDefs={filterDefs}
          initialColumnVisibility={initialColumnVisibility}
          emptyTitle="Nothing on your plate"
          emptyDescription="Tasks assigned to you, or that you assign to your team, appear here."
        />
      </div>
    </>
  );
}
