// Author: Brijesh Dave <https://github.com/brijeshdave>
// The catalogue of job titles, with how many people hold each.
//
// The count is the point of the page: it is what tells you whether a title can be
// deleted, whether two entries are duplicates of the same job, and whether one you
// were about to retire is still carrying half the company.
import { PERMISSIONS, type DesignationRow, formatDate } from "@reportly/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { Badge, Button, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";

const columns: TableColumn<DesignationRow>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Designation",
    cell: ({ row }) => (
      <Link
        to="/designations/$designationId/edit"
        params={{ designationId: row.original.id }}
        className="font-medium text-foreground hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: "userCount",
    accessorKey: "userCount",
    header: "People",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.userCount}
        {row.original.userCount === 0 ? (
          <span className="ml-2 text-xs text-muted-foreground">unused</span>
        ) : null}
      </span>
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge tone={row.original.status === "active" ? "success" : "neutral"}>
        {row.original.status === "active" ? "active" : "retired"}
      </Badge>
    ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

const filterDefs: FilterDef[] = [
  { field: "name", label: "Designation", kind: "text" },
  {
    field: "status",
    label: "Status",
    kind: "select",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Retired" },
    ],
  },
  { field: "createdAt", label: "Created", kind: "daterange" },
];

export function DesignationsListPage() {
  const navigate = useNavigate();
  const list = useListResource<DesignationRow>({
    resource: "designations",
    path: "/designations",
  });

  return (
    <>
      <PageHeader
        title="Designations"
        description="The job titles a user can be given. Renaming one corrects everybody holding it; retiring one stops it being offered, without taking it from anyone."
        actions={
          <Can permission={PERMISSIONS.DESIGNATIONS_CREATE}>
            <Button size="sm" onClick={() => void navigate({ to: "/designations/new" })}>
              <Plus className="h-4 w-4" />
              New designation
            </Button>
          </Can>
        }
      />

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        quickSearch={{ field: "name", placeholder: "Search job titles" }}
        quickToggle={{
          field: "status",
          label: "Active or retired",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Retired" },
          ],
        }}
        emptyTitle="No designations yet"
        emptyDescription="Create the job titles your people can be given."
        renderCard={(designation) => (
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/designations/$designationId/edit"
              params={{ designationId: designation.id }}
              className="truncate text-sm font-medium hover:underline"
            >
              {designation.name}
            </Link>
            <span className="text-xs text-muted-foreground">{designation.userCount} people</span>
          </div>
        )}
      />
    </>
  );
}
