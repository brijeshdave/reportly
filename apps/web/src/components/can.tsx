// Author: Brijesh Dave <https://github.com/brijeshdave>
// Permission gating for the UI. Uses the same `can()` the API guards use, so a
// button is never shown for an action the server would reject. This hides UI only —
// the API remains the enforcement point.
import { type Permission, can } from "@reportly/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { sessionQuery } from "@/lib/queries.js";

/** True when the current session may perform `permission`. */
export function usePermission(permission: Permission): boolean {
  const { data: session } = useSuspenseQuery(sessionQuery);
  return can({ permissions: session.permissions, isSuperadmin: session.isSuperadmin }, permission);
}

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>;
}
