// Author: Brijesh Dave <https://github.com/brijeshdave>
// Roles, as a table: one row per role, like every other resource.
//
// This replaced a matrix that gave each role its own COLUMN. That reads well for
// the four seeded roles and collapses entirely once an organisation adds its own —
// the table grows sideways, off the screen, and every new role makes it worse.
// A permission set belongs to a role, so it is shown on the role, not spread
// across a column.
import { PERMISSIONS, type Role } from "@reportly/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { Can, usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { ImportDialog } from "@/components/import-dialog.js";
import { Badge, Button, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { deleteRole, downloadRoleTemplate, exportRoles, importRoles } from "@/services/roles.js";

const filterDefs: FilterDef[] = [
  { field: "createdAt", label: "Created", kind: "daterange" },
  { field: "name", label: "Name", kind: "text" },
  { field: "isSystem", label: "System role", kind: "boolean" },
];

export function RolesListPage() {
  const [deleting, setDeleting] = useState<Role | null>(null);
  const navigate = useNavigate();

  const canUpdate = usePermission(PERMISSIONS.ROLES_UPDATE);
  const canDelete = usePermission(PERMISSIONS.ROLES_DELETE);
  const canClone = usePermission(PERMISSIONS.ROLES_CLONE);
  const canImport = usePermission(PERMISSIONS.ROLES_IMPORT);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();

  const viewRole = (role: Role) =>
    void navigate({ to: "/roles/$roleId", params: { roleId: role.id } });
  const editRole = (role: Role) =>
    void navigate({ to: "/roles/$roleId/edit", params: { roleId: role.id } });
  const cloneRoleAt = (role: Role) =>
    void navigate({ to: "/roles/$roleId/clone", params: { roleId: role.id } });

  // The API orders system roles first unless an explicit sort is asked for.
  const list = useListResource<Role>({ resource: "roles", path: "/roles" });

  const remove = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });

  const columns: TableColumn<Role>[] = [
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => viewRole(row.original)}
          className="font-medium text-foreground hover:underline"
        >
          {row.original.name}
        </button>
      ),
    },
    {
      id: "isSystem",
      accessorKey: "isSystem",
      header: "Type",
      cell: ({ row }) =>
        row.original.isSystem ? <Badge tone="brand">System</Badge> : <Badge>Custom</Badge>,
    },
    {
      id: "permissions",
      header: "Permissions",
      enableSorting: false,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => viewRole(row.original)}
          className="text-sm text-muted-foreground hover:text-primary hover:underline"
        >
          {row.original.permissions.length} granted
        </button>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const role = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            {canClone ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Clone ${role.name}`}
                onClick={() => cloneRoleAt(role)}
                className="h-8 w-8"
              >
                <Copy className="h-4 w-4" />
              </Button>
            ) : null}

            {/* A system role is immutable: the API refuses, so there is no button. */}
            {canUpdate && !role.isSystem ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${role.name}`}
                onClick={() => editRole(role)}
                className="h-8 w-8"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}

            {canDelete && !role.isSystem ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${role.name}`}
                onClick={() => setDeleting(role)}
                className="h-8 w-8"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="A role is a named bundle of permissions. Assign roles to groups to grant access."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void exportRoles()}>
              <Download className="h-4 w-4" /> Export
            </Button>
            {canImport ? (
              <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import
              </Button>
            ) : null}
            <Can permission={PERMISSIONS.ROLES_CREATE}>
              <Button size="sm" onClick={() => void navigate({ to: "/roles/new" })}>
                <Plus className="h-4 w-4" />
                New role
              </Button>
            </Can>
          </div>
        }
      />

      {importOpen ? (
        <ImportDialog
          title="Import roles"
          description="Roles are matched by name; the Permissions cell (permission keys separated by | ; , or spaces) replaces a role's permissions, and a blank cell leaves them unchanged. System roles can't be changed. If any row is wrong, nothing is saved."
          onClose={() => setImportOpen(false)}
          downloadTemplate={downloadRoleTemplate}
          runImport={importRoles}
          onImported={() => list.refetch()}
        />
      ) : null}

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        emptyTitle="No roles"
        emptyDescription="Create one, or clone a system role to start from its permissions."
        renderCard={(role) => (
          <button
            type="button"
            onClick={() => viewRole(role)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{role.name}</p>
              <p className="text-xs text-muted-foreground">{role.permissions.length} permissions</p>
            </div>
            {role.isSystem ? <Badge tone="brand">System</Badge> : null}
          </button>
        )}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "this role"}?`}
        description="Refused while any group still holds it — the API will name them. Groups keep every other role they hold."
        confirmLabel="Delete role"
        destructive
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
