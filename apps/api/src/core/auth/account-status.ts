// Author: Brijesh Dave <https://github.com/brijeshdave>
// Enforcement of `users.status`. Deactivating a user is how an administrator
// removes someone's access; the column was written and displayed, but nothing
// ever read it, so a deactivated user kept every permission and could sign in
// again. Three places close that:
//
//   1. no new session is created for an inactive user (see auth.ts databaseHooks)
//   2. an existing session is refused by `authenticate` (see plugin.ts)
//   3. deactivating revokes the sessions they already hold (see users/service.ts)
import { eq } from "drizzle-orm";

import { getAuth } from "@/core/auth/auth.js";
import { db } from "@/core/db/index.js";
import { users } from "@/core/db/schema.js";

/** False when the user is deactivated, or no longer exists. */
export async function isUserActive(userId: string): Promise<boolean> {
  const [row] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
  return row?.status === "active";
}

/**
 * True while the user is still on a password an administrator chose for them. It
 * is a working credential that someone else knows, so the app is closed to them
 * until they replace it — the same gate an expired password gets.
 */
export async function mustChangePassword(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ must: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, userId));
  return row?.must ?? false;
}

/** Lift the gate. Called from the account hook, so every path that sets a
 * password clears it — a new one cannot be added that quietly forgets to. */
export async function clearMustChangePassword(userId: string): Promise<void> {
  await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, userId));
}

/**
 * Signs the user out everywhere. Sessions live in Postgres and in the Redis
 * secondary storage; better-auth's adapter clears both.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}

/**
 * Revoke one session. Goes through better-auth rather than deleting the row so
 * the Redis secondary storage is cleared with it — a row-only delete would leave
 * the cached session answering.
 */
export async function revokeSession(token: string): Promise<void> {
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.deleteSession(token);
}
