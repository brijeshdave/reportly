// Author: Brijesh Dave <https://github.com/brijeshdave>
// The people the team supports — the ones an issue happens *to*, who do not use
// Reportly themselves.
//
// The entry count is the point of the page, exactly as head-count is on Designations:
// it is what turns a staff list into the answer to "whose equipment keeps failing",
// and what tells you whether somebody can be deleted or should be made inactive.
import { PERMISSIONS, type EndUser, formatDate } from "@reportly/shared";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, Download, Plus, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { ImportDialog } from "@/components/import-dialog.js";
import { Badge, Button, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDepartments } from "@/services/departments.js";
import { downloadEndUserTemplate, exportEndUsers, importEndUsers } from "@/services/end-users.js";

const columns: TableColumn<EndUser>[] = [
  {
    id: "fullName",
    accessorKey: "fullName",
    header: "Name",
    cell: ({ row }) => (
      <Link
        to="/end-users/$endUserId/edit"
        params={{ endUserId: row.original.id }}
        className="font-medium text-foreground hover:underline"
      >
        {row.original.fullName}
      </Link>
    ),
  },
  {
    id: "employeeNumber",
    accessorKey: "employeeNumber",
    header: "Employee no.",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.employeeNumber}</span>,
  },
  {
    id: "departmentName",
    accessorKey: "departmentName",
    header: "Department",
    // The list sorts on the department's id, not its name, so a sortable header here
    // would order the rows by something nobody can see.
    enableSorting: false,
    cell: ({ row }) =>
      row.original.departmentName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "entryCount",
    accessorKey: "entryCount",
    header: "Entries",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.entryCount ?? 0}
        {(row.original.entryCount ?? 0) === 0 ? (
          <span className="ml-2 text-xs text-muted-foreground">none yet</span>
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
        {row.original.status === "active" ? "active" : "inactive"}
      </Badge>
    ),
  },
  {
    id: "linkedUserName",
    accessorKey: "linkedUserName",
    header: "Reportly account",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.linkedUserName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "description",
    accessorKey: "description",
    header: "Notes",
    enableSorting: false,
    // The one column here that carries a sentence.
    wrap: true,
    cell: ({ row }) => row.original.description ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Added",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
  {
    id: "updatedAt",
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) => formatDate(row.original.updatedAt),
  },
];

export function EndUsersListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const { data: session } = useSuspenseQuery(sessionQuery);

  const list = useListResource<EndUser>({
    resource: "end-users",
    path: "/end-users",
    initial: { sortBy: "fullName", sortDir: "asc" },
  });

  // Only this company's departments: an end user is created against the active
  // company, so a department from another one is not a choice the API would accept.
  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const filterDefs = useMemo<FilterDef[]>(
    () => [
      { field: "fullName", label: "Name", kind: "text" },
      { field: "employeeNumber", label: "Employee number", kind: "text" },
      {
        field: "departmentId",
        label: "Department",
        kind: "combobox",
        options: departmentOptions(
          (departments.data ?? [])
            .filter((d) => d.companyId === session.companyId)
            .map((d) => ({ value: d.id, name: d.name, path: d.path })),
        ),
      },
      {
        field: "status",
        label: "Status",
        kind: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
      { field: "createdAt", label: "Added", kind: "daterange" },
    ],
    [departments.data, session.companyId],
  );

  // The list belongs to a company; without one the request can only 400.
  if (!session.companyId) {
    return (
      <>
        <PageHeader
          title="End users"
          description="The people your team supports, who do not use Reportly themselves."
        />
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher to see and manage its end users."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="End users"
        description="The people your team supports. They have no Reportly account — this list is what lets an entry say who the fault happened to, and what lets the reports answer whose equipment keeps failing. Somebody who has left is made inactive, not deleted: their history is what the reports are made of."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportEndUsers()}>
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Can permission={PERMISSIONS.END_USERS_IMPORT}>
              <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
                <Upload className="h-4 w-4" />
                Import
              </Button>
            </Can>
            <Can permission={PERMISSIONS.END_USERS_CREATE}>
              <Button size="sm" onClick={() => void navigate({ to: "/end-users/new" })}>
                <Plus className="h-4 w-4" />
                New end user
              </Button>
            </Can>
          </div>
        }
      />

      {importing ? (
        <ImportDialog
          title="Import end users"
          description="People are matched on their employee number — a number already here is corrected, a new one is added. A department name that does not exist is reported rather than created. If any row is wrong, nothing is saved."
          onClose={() => setImporting(false)}
          downloadTemplate={downloadEndUserTemplate}
          runImport={importEndUsers}
          onImported={() => queryClient.invalidateQueries({ queryKey: ["end-users"] })}
        />
      ) : null}

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        // The one thing anybody types here, without opening the panel first.
        quickSearch={{ field: "search", placeholder: "Search by name or employee no." }}
        quickToggle={{
          field: "status",
          label: "Active or inactive",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        }}
        // Off by default rather than absent: nine columns crowd the table, and the
        // Columns menu is where somebody who wants the notes or the dates goes.
        initialColumnVisibility={{
          linkedUserName: false,
          description: false,
          createdAt: false,
          updatedAt: false,
        }}
        emptyTitle="Nobody on the list yet"
        emptyDescription="Add the people your team supports, or import them from a spreadsheet."
        renderCard={(person) => (
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/end-users/$endUserId/edit"
              params={{ endUserId: person.id }}
              className="truncate text-sm font-medium hover:underline"
            >
              {person.fullName}
            </Link>
            <span className="text-xs text-muted-foreground">
              {person.departmentName ?? "no department"} · {person.entryCount ?? 0} entries
            </span>
          </div>
        )}
      />
    </>
  );
}
