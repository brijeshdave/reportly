// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating, cloning and editing a custom role — a full page, not a modal, because a
// permission set is a substantial thing to build and deserves the room.
//
// The catalogue is arranged the way the sidebar is: a tab per area of the product,
// and inside it a card per resource. Flat, it was two dozen boxes of checkboxes that
// nobody read. Every tick lives in one `selected` set held here, so switching tabs
// keeps everything — including half-made changes in tabs you have left — and nothing
// reaches the server until Save.
//
// Editing a role changes what every group holding it may do, retroactively. That is
// why system roles are frozen, and why editing a held role names who it affects
// before the save, not after.
import { ALL_PERMISSIONS, type Permission, type Role } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { PageTabs } from "@/components/page-tabs.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { PERMISSION_GROUPS, actionOf, resourceLabel } from "@/routes/roles/permission-groups.js";
import {
  cloneRole,
  createRole,
  fetchRole,
  fetchRoleReferences,
  updateRole,
} from "@/services/roles.js";

export type RoleEditorPageMode = "create" | "edit" | "clone";

const COPY: Record<RoleEditorPageMode, { title: string; submit: string; description: string }> = {
  create: {
    title: "New role",
    submit: "Create role",
    description: "Members of any group holding this role get every permission ticked here.",
  },
  clone: {
    title: "Clone role",
    submit: "Create copy",
    description: "An editable copy. The original role is left untouched.",
  },
  edit: {
    title: "Edit role",
    submit: "Save changes",
    description: "Changing a role changes what every group holding it may do, retroactively.",
  },
};

export function RoleEditorPage({ mode, roleId }: { mode: RoleEditorPageMode; roleId?: string }) {
  // create has no source; edit and clone load the role behind the id.
  const source = useQuery({
    queryKey: ["roles", "one", roleId],
    queryFn: () => fetchRole(roleId as string),
    enabled: mode !== "create" && Boolean(roleId),
  });

  if (mode !== "create" && source.isLoading) return <Spinner />;
  if (mode !== "create" && source.error) return <ErrorAlert error={source.error} />;

  return <Editor mode={mode} role={source.data} />;
}

function Editor({ mode, role }: { mode: RoleEditorPageMode; role?: Role }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = COPY[mode];

  const [name, setName] = useState(
    mode === "clone" ? `${role?.name ?? ""} copy` : mode === "edit" ? (role?.name ?? "") : "",
  );
  const [selected, setSelected] = useState<Set<Permission>>(
    new Set(mode === "create" ? [] : ((role?.permissions ?? []) as Permission[])),
  );
  const [activeTab, setActiveTab] = useState(PERMISSION_GROUPS[0]?.id ?? "");

  // Only an edit can affect groups that already hold the role.
  const references = useQuery({
    queryKey: ["roles", "references", role?.id ?? "none"],
    queryFn: () => fetchRoleReferences(role!.id),
    enabled: mode === "edit" && Boolean(role),
  });

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["roles"] });
    await navigate({ to: "/roles" });
  };

  const save = useMutation({
    mutationFn: () => {
      const permissions = [...selected];
      if (mode === "edit") return updateRole(role!.id, { name: name.trim(), permissions });
      if (mode === "clone") {
        const unchanged =
          role !== undefined &&
          permissions.length === role.permissions.length &&
          role.permissions.every((permission) => selected.has(permission as Permission));
        return cloneRole(role!.id, name.trim()).then((created) =>
          unchanged ? created : updateRole(created.id, { permissions }),
        );
      }
      return createRole(name.trim(), permissions);
    },
    onSuccess: done,
  });

  const toggle = (permission: Permission) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });

  const setMany = (permissions: Permission[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const permission of permissions) {
        if (on) next.add(permission);
        else next.delete(permission);
      }
      return next;
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const affected = references.data ?? [];
  const group = PERMISSION_GROUPS.find((g) => g.id === activeTab) ?? PERMISSION_GROUPS[0];
  const groupAll = group?.permissions.every((p) => selected.has(p)) ?? false;

  return (
    <>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button variant="secondary" size="sm" onClick={() => void navigate({ to: "/roles" })}>
            Back to roles
          </Button>
        }
      />

      <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
        {save.error ? <ErrorAlert error={save.error} /> : null}

        {mode === "edit" && affected.length > 0 ? (
          <Alert tone="info">
            {affected.length === 1 ? "One group holds" : `${affected.length} groups hold`} this
            role: {affected.map((group) => group.name).join(", ")}. Saving changes what their
            members may do.
          </Alert>
        ) : null}

        <div className="max-w-md">
          <Field label="Name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                disabled={save.isPending}
              />
            )}
          </Field>
        </div>

        <fieldset className="flex flex-col gap-4" disabled={save.isPending}>
          <legend className="sr-only">Permissions</legend>

          {/* Counts on the tabs, so where a role's power sits is visible without
              opening every tab. Ticks live in one set, so switching loses nothing. */}
          <PageTabs
            tabs={PERMISSION_GROUPS.map((g) => ({
              id: g.id,
              label: `${g.label} (${g.permissions.filter((p) => selected.has(p)).length}/${g.permissions.length})`,
            }))}
            active={activeTab}
            onSelect={setActiveTab}
          />

          {group ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {group.permissions.filter((p) => selected.has(p)).length} of{" "}
                  {group.permissions.length} granted in {group.label}
                </p>
                <button
                  type="button"
                  onClick={() => setMany(group.permissions, !groupAll)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {groupAll ? `Clear ${group.label}` : `Select all of ${group.label}`}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.resources.map(({ resource, permissions }) => {
                  const all = permissions.every((permission) => selected.has(permission));
                  const grantedHere = permissions.filter((p) => selected.has(p)).length;
                  return (
                    <Card key={resource} className="p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold capitalize">
                          {resourceLabel(resource)}
                        </h3>
                        <Badge tone={grantedHere > 0 ? "brand" : "neutral"}>
                          {grantedHere}/{permissions.length}
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        {permissions.map((permission) => (
                          <label key={permission} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selected.has(permission)}
                              onChange={() => toggle(permission)}
                              aria-label={permission}
                            />
                            {actionOf(permission)}
                          </label>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => setMany(permissions, !all)}
                        className="mt-2 text-xs font-medium text-primary hover:underline"
                      >
                        {all ? "Clear all" : "Select all"}
                      </button>
                    </Card>
                  );
                })}
              </div>
            </>
          ) : null}
        </fieldset>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background py-3">
          <span className="text-xs text-muted-foreground">
            {selected.size} of {ALL_PERMISSIONS.length} permissions
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/roles" })}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending || name.trim() === ""}>
              {save.isPending ? <Spinner /> : null}
              {copy.submit}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
