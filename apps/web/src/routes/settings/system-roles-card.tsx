// Author: Brijesh Dave <https://github.com/brijeshdave>
// The warning that belongs beside the "system roles" switch.
//
// Turning the shipped roles off is reversible — nothing is deleted, the group↔role
// rows stay exactly as they are — but it is not harmless: anybody whose only access
// comes through a system role signs in to an empty app the moment it is flicked. So
// the number is shown *before* the decision rather than discovered after it.
//
// The Superadmin group bypasses roles entirely, which is the escape hatch and is
// worth saying on the screen: whoever turns it off can always turn it back on.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { Alert } from "@/components/ui/form.js";
import { Card } from "@/components/ui/primitives.js";
import { fetchSystemRoleImpact } from "@/services/roles.js";

export function SystemRolesNotice() {
  const impact = useQuery({
    queryKey: ["roles", "system-impact"],
    queryFn: fetchSystemRoleImpact,
    staleTime: 30_000,
  });

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
        <h2 className="text-sm font-semibold">Before you switch the shipped roles off</h2>
      </div>

      <p className="text-sm text-muted-foreground">
        Turning them off hides them from every picker and stops them granting anything.{" "}
        <strong className="font-medium text-foreground">Nothing is deleted</strong> — each group
        keeps the roles it holds, so turning them back on restores every grant exactly.
      </p>

      {impact.data ? (
        impact.data.users > 0 ? (
          <Alert tone="warning">
            <strong className="font-medium">
              {impact.data.users} {impact.data.users === 1 ? "person" : "people"} would lose all
              access
            </strong>{" "}
            — their groups hold system roles and nothing else
            {impact.data.groups > 0
              ? ` (${impact.data.groups} ${impact.data.groups === 1 ? "group" : "groups"})`
              : ""}
            . Give those groups a custom role first, or expect them to sign in to an empty app.
          </Alert>
        ) : impact.data.groups > 0 ? (
          <Alert tone="info">
            Nobody loses access today — but{" "}
            <strong className="font-medium">
              {impact.data.groups} {impact.data.groups === 1 ? "group" : "groups"} would grant
              nothing
            </strong>
            , holding only shipped roles. Anybody added to one would find an empty app.
          </Alert>
        ) : (
          <Alert tone="success">
            Nobody would lose access: every group that grants anything holds a role of your own.
          </Alert>
        )
      ) : null}

      <p className="text-xs text-muted-foreground">
        Superadmins are unaffected — the Superadmin group grants its access directly rather than
        through a role, so you can always switch this back on.
      </p>
    </Card>
  );
}
