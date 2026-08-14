// Author: Brijesh Dave <https://github.com/brijeshdave>
// Debug-mode service. `active` reflects the system switch OR the caller's own,
// both auto-expiring server-side.
import type { DebugMode } from "@reportly/shared";

import { http } from "@/services/http.js";

export interface DebugStatus {
  system: DebugMode;
  user: DebugMode | null;
  active: boolean;
}

export function fetchDebugStatus(): Promise<DebugStatus> {
  return http.get<DebugStatus>("/debug");
}

export function enableDebug(scope: "system" | "user", minutes = 60): Promise<DebugStatus> {
  return http.post<DebugStatus>("/debug/enable", { scope, minutes });
}

export function disableDebug(scope: "system" | "user"): Promise<DebugStatus> {
  return http.post<DebugStatus>("/debug/disable", { scope });
}
