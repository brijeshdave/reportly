// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tasks — what you have been asked to do, and what you have asked of others.
//
// The list is filtered to open work by default. A task list that opens on everything
// ever finished buries the two jobs due today under a year of completed ones.
import { PERMISSIONS, type TaskRow, formatDate } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo } from "react";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { Badge, Button, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { fetchOrgPeople } from "@/services/departments.js";

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

const PRIORITY_TONE = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
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
  { id: "assigneeName", accessorKey: "assigneeName", header: "Assigned to" },
  { id: "assignerName", accessorKey: "assignerName", header: "Assigned by" },
  {
    id: "priority",
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) => (
      <Badge tone={PRIORITY_TONE[row.original.priority]}>{row.original.priority}</Badge>
    ),
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
];

export function TasksListPage() {
  const navigate = useNavigate();
  const people = useQuery({ queryKey: ["org", "people"], queryFn: fetchOrgPeople });
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
        options: (people.data ?? []).map((p) => ({
          value: p.userId,
          label: p.name,
          hint: p.departmentNames.join(", ") || undefined,
        })),
      },
      { field: "dueAt", label: "Due", kind: "daterange" },
    ],
    [people.data],
  );
  const list = useListResource<TaskRow>({
    resource: "tasks",
    path: "/tasks",
    // Soonest deadline first, and open work only — the two questions a task list is
    // opened to answer. Both are ordinary filters, so they clear like any other.
    initial: {
      sortBy: "dueAt",
      sortDir: "asc",
      filters: [{ field: "state", op: "in", value: ["open", "in_progress"] }],
    },
  });

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Work you have been asked to do, and work you have asked of others. Completing a task opens a report pre-filled from it, so the work still gets logged."
        actions={
          <Can permission={PERMISSIONS.TASKS_CREATE}>
            <Button size="sm" onClick={() => void navigate({ to: "/tasks/new" })}>
              <Plus className="h-4 w-4" />
              Assign a task
            </Button>
          </Can>
        }
      />

      <div className="pt-4">
        <DataTable
          {...list}
          columns={columns}
          filterDefs={filterDefs}
          emptyTitle="Nothing on your plate"
          emptyDescription="Tasks assigned to you, or that you assign to your team, appear here."
        />
      </div>
    </>
  );
}
