// Author: Brijesh Dave <https://github.com/brijeshdave>
// Password history: the `reuseCount` and `expiryDays` halves of the password
// policy. Neither can be answered from the password string alone, which is why
// they live here rather than in the shared string-rule checker.
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { accounts, passwordHistory } from "@/core/db/schema.js";

/** better-auth stores the credential password on this provider. */
const CREDENTIAL = "credential";

/** Verifies a plaintext password against a stored hash. Supplied by better-auth. */
export type VerifyPassword = (input: { hash: string; password: string }) => Promise<boolean>;

async function currentHash(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, CREDENTIAL)));
  return row?.password ?? null;
}

/** The most recent `limit` hashes, newest first. */
async function recentHashes(userId: string, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ passwordHash: passwordHistory.passwordHash })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, userId))
    .orderBy(desc(passwordHistory.createdAt))
    .limit(limit);
  return rows.map((row) => row.passwordHash);
}

/**
 * Copies the user's current credential hash into their history. Call this after
 * a password has been written, so the stored hash is recorded exactly as it is —
 * never re-hashed, which would produce a different salt and never match.
 */
export async function recordCurrentPassword(userId: string): Promise<void> {
  const hash = await currentHash(userId);
  if (!hash) return;

  // A no-op write (same hash already newest) would push a real previous password
  // out of the reuse window.
  const [newest] = await recentHashes(userId, 1);
  if (newest === hash) return;

  await db.insert(passwordHistory).values({ userId, passwordHash: hash });
}

/**
 * True when `password` matches one of the user's last `reuseCount` passwords,
 * including the one currently set. `reuseCount: 0` disables the rule.
 */
export async function isPasswordReused(
  userId: string,
  password: string,
  reuseCount: number,
  verify: VerifyPassword,
): Promise<boolean> {
  if (reuseCount <= 0) return false;

  const hashes = new Set(await recentHashes(userId, reuseCount));
  // The current password may not yet be in history (a user who has never changed
  // it), and reusing it is still reuse.
  const current = await currentHash(userId);
  if (current) hashes.add(current);

  for (const hash of hashes) {
    if (await verify({ hash, password })) return true;
  }
  return false;
}

/** When the user's password was last set, or null if we have never recorded one. */
export async function passwordSetAt(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: passwordHistory.createdAt })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, userId))
    .orderBy(desc(passwordHistory.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

/**
 * True when the password is older than `expiryDays`. `expiryDays: 0` disables
 * expiry. A user whose password predates this feature has no history row: they
 * are treated as current rather than locked out of an account they can still use.
 */
export async function isPasswordExpired(
  userId: string,
  expiryDays: number,
  now = new Date(),
): Promise<boolean> {
  if (expiryDays <= 0) return false;

  const setAt = await passwordSetAt(userId);
  if (!setAt) return false;

  const ageMs = now.getTime() - setAt.getTime();
  return ageMs > expiryDays * 24 * 60 * 60 * 1000;
}
