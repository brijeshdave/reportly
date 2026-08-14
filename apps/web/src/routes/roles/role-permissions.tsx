// Author: Brijesh Dave <https://github.com/brijeshdave>
// What one role grants, read-only, arranged the way the sidebar is: a tab per area
// of the product, and inside it a block per resource. Each tab carries its own
// granted count, so you can see where a role's power sits without opening every tab.
//
// This used to be a right-hand slide-over. A permission set is a big thing to read;
// it now lives on a full page, like the editor, so both look and scroll the same.
import { ALL_PERMISSIONS, type Role } from "@reportly/shared";
import { Check, X } from "lucide-react";
import { useState } from "react";

import { PageTabs } from "@/components/page-tabs.js";
import { Badge, Card } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { PERMISSION_GROUPS, actionOf, resourceLabel } from "@/routes/roles/permission-groups.js";

export function RolePermissionMatrix({ role }: { role: Role }) {
  const [active, setActive] = useState(PERMISSION_GROUPS[0]?.id ?? "");
  const held = new Set<string>(role.permissions);
  const group = PERMISSION_GROUPS.find((g) => g.id === active) ?? PERMISSION_GROUPS[0];

  return (
    <div className="flex flex-col gap-4">
      <PageTabs
        tabs={PERMISSION_GROUPS.map((g) => ({
          id: g.id,
          label: `${g.label} (${g.permissions.filter((p) => held.has(p)).length}/${g.permissions.length})`,
        }))}
        active={active}
        onSelect={setActive}
      />

      {group ? (
        <div className="grid gap-3 md:grid-cols-2">
          {group.resources.map(({ resource, permissions }) => {
            const grantedHere = permissions.filter((p) => held.has(p)).length;
            return (
              <Card key={resource} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold capitalize">{resourceLabel(resource)}</h3>
                  <Badge tone={grantedHere > 0 ? "brand" : "neutral"}>
                    {grantedHere}/{permissions.length}
                  </Badge>
                </div>

                <ul className="grid gap-1.5">
                  {permissions.map((permission) => {
                    const granted = held.has(permission);
                    const Icon = granted ? Check : X;
                    return (
                      <li key={permission} className="flex items-center gap-2 text-sm">
                        <Icon
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            granted ? "text-success" : "text-muted-foreground/50",
                          )}
                          aria-hidden
                        />
                        <span className={cn(!granted && "text-muted-foreground")}>
                          {actionOf(permission)}
                        </span>
                        <span className="sr-only">
                          {role.name} {granted ? "has" : "does not have"} {permission}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {role.permissions.length} of {ALL_PERMISSIONS.length} permissions granted
        {role.isSystem ? " · this is a system role, clone it to change what it grants" : ""}
      </p>
    </div>
  );
}
