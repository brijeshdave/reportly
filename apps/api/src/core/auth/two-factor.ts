// Author: Brijesh Dave <https://github.com/brijeshdave>
// Stripping two-factor from an account — the recovery path for someone who has
// lost both their authenticator and their recovery codes.
//
// Without this there is no way back: better-auth's own /two-factor/disable needs
// the account's own password *and* a passing second factor, so the very person who
// is locked out is the only one who could use it. The capability is deliberately
// narrow — it removes a factor, it never adds a session — and every caller of it
// (the admin route, the CLI) is audited or requires shell access to the box.
import { eq } from "drizzle-orm";

import { revokeAllSessions } from "@/core/auth/account-status.js";
import { db } from "@/core/db/index.js";
import { twoFactors, users } from "@/core/db/schema.js";

/**
 * Remove the user's second factor and sign them out everywhere.
 *
 * The sign-out is the point, not a side effect: better-auth issues "trust this
 * device" cookies that skip the challenge, and a live session outlives the secret
 * it was granted under. Leaving either in place would mean the factor was gone but
 * the doors it had opened were still ajar.
 *
 * Returns whether the account actually had two-factor on, so a caller can say
 * "there was nothing to reset" rather than reporting a reset that did nothing.
 */
export async function resetTwoFactor(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ enabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.id, userId));
  const wasEnabled = user?.enabled ?? false;

  await db.delete(twoFactors).where(eq(twoFactors.userId, userId));
  await db
    .update(users)
    .set({ twoFactorEnabled: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await revokeAllSessions(userId);

  return wasEnabled;
}
