// Author: Brijesh Dave <https://github.com/brijeshdave>
// One role, full page: what it grants and who it affects. A full page rather than a
// slide-over so viewing and editing a role read the same way and have the same room —
// a permission set is too big to study through a panel.
import { PERMISSIONS, type Role } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy, Pencil } from "lucide-react";

import { usePermission } from "@/components/can.js";
import { Alert, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, PageHeader } from "@/components/ui/primitives.js";
import { RolePermissionMatrix } from "@/routes/roles/role-permissions.js";
import { fetchRole, fetchRoleReferences } from "@/services/roles.js";

export function RoleDetailPage({ roleId }: { roleId: string }) {
  const navigate = useNavigate();
  const canUpdate = usePermission(PERMISSIONS.ROLES_UPDATE);
  const canClone = usePermission(PERMISSIONS.ROLES_CLONE);

  const role = useQuery({
    queryKey: ["roles", "one", roleId],
    queryFn: () => fetchRole(roleId),
  });

  const references = useQuery({
    queryKey: ["roles", "references", roleId],
    queryFn: () => fetchRoleReferences(roleId),
  });

  if (role.isLoading) return <Spinner />;
  if (role.error) return <ErrorAlert error={role.error} />;
  if (!role.data) return null;

  const data: Role = role.data;
  const holders = references.data ?? [];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {data.name}
            {data.isSystem ? <Badge tone="brand">System</Badge> : <Badge>Custom</Badge>}
          </span>
        }
        description="What this role grants. Members of any group holding it get every permission ticked here."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void navigate({ to: "/roles" })}>
              Back to roles
            </Button>
            {canClone ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void navigate({ to: "/roles/$roleId/clone", params: { roleId } })}
              >
                <Copy className="mr-1.5 h-4 w-4" />
                Clone
              </Button>
            ) : null}
            {/* A system role is immutable: the API refuses, so there is no button. */}
            {canUpdate && !data.isSystem ? (
              <Button
                size="sm"
                onClick={() => void navigate({ to: "/roles/$roleId/edit", params: { roleId } })}
              >
                <Pencil className="mr-1.5 h-4 w-4" />
                Edit permissions
              </Button>
            ) : null}
          </div>
        }
      />

      {holders.length > 0 ? (
        <Alert tone="info">
          {holders.length === 1 ? "One group holds" : `${holders.length} groups hold`} this role:{" "}
          {holders.map((group) => group.name).join(", ")}.
        </Alert>
      ) : null}

      <div className="pt-4">
        <RolePermissionMatrix role={data} />
      </div>
    </>
  );
}
