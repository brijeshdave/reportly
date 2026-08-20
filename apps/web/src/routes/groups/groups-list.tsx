// Author: Brijesh Dave <https://github.com/brijeshdave>
// Groups list. Groups are the join point: they hold the roles, and the companies
// and locations those roles apply to. System groups are immutable but clonable.
import { PERMISSIONS, type Group, formatDate } from "@reportly/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Copy, Download, Plus, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { ImportDialog } from "@/components/import-dialog.js";
import { Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { usePermission } from "@/components/can.js";
import {
  cloneGroup,
  createGroup,
  downloadGroupTemplate,
  exportGroups,
  importGroups,
} from "@/services/groups.js";

const filterDefs: FilterDef[] = [
  { field: "createdAt", label: "Created", kind: "daterange" },
  { field: "name", label: "Name", kind: "text" },
  { field: "isSystem", label: "System group", kind: "boolean" },
];

export function GroupsListPage() {
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "clone"; group: Group } | null>(
    null,
  );
  const canCreate = usePermission(PERMISSIONS.GROUPS_CREATE);
  const canImport = usePermission(PERMISSIONS.GROUPS_IMPORT);
  const [importOpen, setImportOpen] = useState(false);
  const list = useListResource<Group>({ resource: "groups", path: "/groups" });

  const columns: TableColumn<Group>[] = [
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <Link
          to="/groups/$groupId"
          params={{ groupId: row.original.id }}
          className="font-medium text-foreground hover:underline"
        >
          {row.original.name}
        </Link>
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
      id: "createdAt",
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) =>
        canCreate ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDialog({ mode: "clone", group: row.original })}
          >
            <Copy className="h-4 w-4" />
            Clone
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Groups"
        description="Groups grant permissions, scoped to companies and locations."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void exportGroups()}>
              <Download className="h-4 w-4" /> Export
            </Button>
            {canImport ? (
              <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import
              </Button>
            ) : null}
            <Can permission={PERMISSIONS.GROUPS_CREATE}>
              <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
                <Plus className="h-4 w-4" />
                New group
              </Button>
            </Can>
          </div>
        }
      />

      {importOpen ? (
        <ImportDialog
          title="Import groups"
          description="Groups are matched by name; the Roles cell (role names separated by | or ;) replaces a group's roles, and a blank cell leaves them unchanged. System groups can't be changed. If any row is wrong, nothing is saved."
          onClose={() => setImportOpen(false)}
          downloadTemplate={downloadGroupTemplate}
          runImport={importGroups}
          onImported={() => list.refetch()}
        />
      ) : null}

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        quickSearch={{ field: "name", placeholder: "Search groups" }}
        quickToggle={{
          field: "isSystem",
          label: "Shipped or your own",
          options: [
            { value: true, label: "System" },
            { value: false, label: "Custom" },
          ],
        }}
        emptyTitle="No groups yet"
        emptyDescription="Create a group, or clone a system group to start from its roles."
        renderCard={(group) => (
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/groups/$groupId"
              params={{ groupId: group.id }}
              className="truncate text-sm font-medium hover:underline"
            >
              {group.name}
            </Link>
            {group.isSystem ? <Badge tone="brand">System</Badge> : null}
          </div>
        )}
      />

      {dialog ? <GroupNameDialog dialog={dialog} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

/** Create and clone differ only in the endpoint and the wording. */
function GroupNameDialog({
  dialog,
  onClose,
}: {
  dialog: { mode: "create" } | { mode: "clone"; group: Group };
  onClose: () => void;
}) {
  const cloning = dialog.mode === "clone";
  const [name, setName] = useState(cloning ? `${dialog.group.name} copy` : "");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const submit = useMutation({
    mutationFn: (value: string) =>
      cloning ? cloneGroup(dialog.group.id, value) : createGroup(value),
    onSuccess: async (group) => {
      await queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
      await navigate({ to: "/groups/$groupId", params: { groupId: group.id } });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit.mutate(name.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={cloning ? "Clone group" : "New group"}
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-base font-semibold">{cloning ? "Clone group" : "New group"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {cloning
            ? `Copies the roles, companies and locations of ${dialog.group.name} into a new, editable group. Members are not copied.`
            : "An empty group. Add roles and members from its detail page."}
        </p>

        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
          {submit.error ? <ErrorAlert error={submit.error} /> : null}

          <Field label="Name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                disabled={submit.isPending}
              />
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={submit.isPending}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submit.isPending || name.trim() === ""}>
              {submit.isPending ? <Spinner /> : null}
              {cloning ? "Clone group" : "Create group"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
