// Author: Brijesh Dave <https://github.com/brijeshdave>
// Debug mode: a settings-backed, auto-expiring verbosity switch that can be set
// system-wide or per user. System state is kept as a synchronous snapshot because
// every request consults it; the per-user value is resolved during authentication.
// Debug is active when EITHER scope is active (system OR user).
import { DEBUG_MODE, type DebugMode, defaultFor, isDebugActive } from "@reportly/shared";

import {
  getSystemSetting,
  getUserSetting,
  setSystemSetting,
  setUserSetting,
} from "@/core/settings/service.js";

export const DEBUG_MAX_MINUTES = 24 * 60;
export const DEBUG_DEFAULT_MINUTES = 60;

let systemSnapshot: DebugMode = defaultFor(DEBUG_MODE);

export function isSystemDebugActive(): boolean {
  return isDebugActive(systemSnapshot);
}

export function getSystemDebug(): DebugMode {
  return systemSnapshot;
}

export async function reloadDebugConfig(): Promise<DebugMode> {
  systemSnapshot = await getSystemSetting(DEBUG_MODE);
  return systemSnapshot;
}

export async function isUserDebugActive(userId: string): Promise<boolean> {
  const value = await getUserSetting(DEBUG_MODE, userId);
  return value !== null && isDebugActive(value);
}

/** Debug applies if the system switch or the user's own switch is active. */
export async function resolveDebug(userId: string): Promise<boolean> {
  if (isSystemDebugActive()) return true;
  return isUserDebugActive(userId);
}

function expiryFrom(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function enableSystemDebug(minutes: number): Promise<DebugMode> {
  const value = await setSystemSetting(DEBUG_MODE, {
    enabled: true,
    expiresAt: expiryFrom(minutes),
  });
  await reloadDebugConfig();
  return value;
}

export async function disableSystemDebug(): Promise<DebugMode> {
  const value = await setSystemSetting(DEBUG_MODE, { enabled: false, expiresAt: null });
  await reloadDebugConfig();
  return value;
}

export async function enableUserDebug(userId: string, minutes: number): Promise<DebugMode> {
  return setUserSetting(DEBUG_MODE, userId, { enabled: true, expiresAt: expiryFrom(minutes) });
}

export async function disableUserDebug(userId: string): Promise<DebugMode> {
  return setUserSetting(DEBUG_MODE, userId, { enabled: false, expiresAt: null });
}

export async function debugStatus(userId: string): Promise<{
  system: DebugMode;
  user: DebugMode | null;
  active: boolean;
}> {
  const user = await getUserSetting(DEBUG_MODE, userId);
  return {
    system: systemSnapshot,
    user,
    active: isSystemDebugActive() || (user !== null && isDebugActive(user)),
  };
}
