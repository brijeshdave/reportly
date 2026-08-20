// Author: Brijesh Dave <https://github.com/brijeshdave>
// What this group actually grants — the union of its roles, arranged the way the role
// editor arranges the catalogue.
//
// This exists because "which roles does it hold?" is not the question anybody has.
// A group with four roles answers it four times over, with overlaps, and working out
// whether somebody in it can delete a device means opening each role in turn and
// holding the answer in your head. The union is one screen, and it is also what the
// server computes when it decides a request.
//
// Derived on the client on purpose: the roles are already loaded for the picker beside
// it, so the answer costs nothing, and an endpoint that returned a *second* opinion
// about what a group grants is a second thing that can be wrong.
import { PERMISSIONS, type Permission, type Role } from "@reportly/shared";

import { Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Card, EmptyState } from "@/components/ui/primitives.js";
import { useOptions } from "@/hooks/use-options.js";
import { usePermission } from "@/components/can.js";
import { PERMISSION_GROUPS, actionOf, resourceLabel } from "@/routes/roles/permission-groups.js";
import { ShieldCheck } from "lucide-react";

export function EffectivePermissionsTab({ roleIds }: { roleIds: string[] }) {
  const mayRead = usePermission(PERMISSIONS.ROLES_READ);
  const roles = useOptions<Role>("roles", "/roles", mayRead);

  if (!mayRead) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Roles are not visible to you"
        description="Seeing what a group grants means reading the roles behind it, which needs roles:read."
      />
    );
  }
  if (roles.isLoading) return <Spinner />;
  if (roles.error) return <ErrorAlert error={roles.error} />;

  const held = (roles.data ?? []).filter((role) => roleIds.includes(role.id));
  const granted = new Set<Permission>(held.flatMap((role) => role.permissions));

  // Which roles grant a given key, so a surprising permission can be traced back to
  // the role that brought it rather than merely noticed.
  const sources = new Map<Permission, string[]>();
  for (const role of held) {
    for (const permission of role.permissions) {
      sources.set(permission, [...(sources.get(permission) ?? []), role.name]);
    }
  }

  if (granted.size === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="This group grants nothing yet"
        description="Give it a role on the Roles tab. Until then its members have an account and no access."
      />
    );
  }

  const groups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    resources: group.resources
      .map((block) => ({
        ...block,
        permissions: block.permissions.filter((permission) => granted.has(permission)),
      }))
      .filter((block) => block.permissions.length > 0),
  })).filter((group) => group.resources.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">{granted.size} permissions</strong> from{" "}
        {held.length} {held.length === 1 ? "role" : "roles"}. This is what the server checks when
        somebody in this group makes a request.
      </p>

      {groups.map((group) => (
        <Card key={group.id} className="flex flex-col gap-3 p-6">
          <h3 className="text-sm font-semibold">{group.label}</h3>
          {group.resources.map((block) => (
            <div key={block.resource} className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {resourceLabel(block.resource)}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {block.permissions.map((permission) => (
                  <Badge
                    key={permission}
                    tone="neutral"
                    // The role it came from, on hover — enough to answer "why does this
                    // group have that?" without leaving the page.
                    title={`from ${(sources.get(permission) ?? []).join(", ")}`}
                  >
                    {actionOf(permission)}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
