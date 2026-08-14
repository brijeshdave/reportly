// Author: Brijesh Dave <https://github.com/brijeshdave>
// Developer preview of the DataTable, behind debug mode. It runs against the real
// /users endpoint so the demo exercises server-side paging, sorting and filtering
// rather than a fixture that can silently drift from the API.
import { formatDate } from "@reportly/shared";
import type { User } from "@reportly/shared";

import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { Badge, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";

const columns: TableColumn<User>[] = [
  { id: "name", accessorKey: "name", header: "Name" },
  { id: "email", accessorKey: "email", header: "Email" },
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
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

const filterDefs: FilterDef[] = [
  { field: "name", label: "Name", kind: "text" },
  { field: "email", label: "Email", kind: "text" },
  {
    field: "status",
    label: "Status",
    kind: "select",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
  },
];

export function TableDemoPage() {
  const list = useListResource<User>({
    resource: "users",
    path: "/users",
    initial: { sortBy: "name" },
  });

  return (
    <>
      <PageHeader
        title="DataTable"
        description="Server-side pagination, sorting and filtering against /users."
      />
      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        emptyTitle="No users yet"
        emptyDescription="Invite someone to get started."
        renderCard={(user) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Badge tone={user.status === "active" ? "success" : "neutral"}>{user.status}</Badge>
          </div>
        )}
      />
    </>
  );
}
