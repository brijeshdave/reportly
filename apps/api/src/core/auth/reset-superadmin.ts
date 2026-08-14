// Author: Brijesh Dave <https://github.com/brijeshdave>
// Resets the seeded superadmin's password — to a fresh random value, or to one the
// operator supplies. Used by `cli reset-superadmin`, the only way to set it.
import { randomBytes, randomUUID } from "node:crypto";

import { PASSWORD_POLICY, isPasswordValid, passwordViolations } from "@reportly/shared";
import { and, eq } from "drizzle-orm";

import { getAuth } from "@/core/auth/auth.js";
import { recordCurrentPassword } from "@/core/auth/password-history.js";
import { db } from "@/core/db/index.js";
import { accounts, users } from "@/core/db/schema.js";
import { env } from "@/core/env.js";
import { getSystemSetting } from "@/core/settings/service.js";

/**
 * 24 url-safe chars of entropy. This path writes the hash directly, bypassing
 * the auth endpoints (and so the policy hook), so the policy is applied here by
 * rejection sampling — a base64url string may happen to contain no digit.
 */
async function generatePassword(): Promise<string> {
  const policy = await getSystemSetting(PASSWORD_POLICY);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = randomBytes(18).toString("base64url");
    if (isPasswordValid(policy, candidate)) return candidate;
  }
  // Only reachable if the policy demands something base64url cannot produce.
  throw new Error("Could not generate a password satisfying the configured policy");
}

/**
 * Resets the superadmin's password and returns it.
 *
 * `chosen` lets an operator set a known password instead of a generated one — the
 * case the generated value cannot serve, where you need the credential *before* you
 * can read a terminal (seeding a dev box, an automated environment). It is still
 * held to the configured policy: this path writes the hash directly and so never
 * reaches better-auth's policy hook, and a command that could quietly install a
 * password the policy forbids would make the policy a suggestion.
 */
export async function resetSuperadmin(chosen?: string): Promise<string> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.SUPERADMIN_EMAIL));
  if (!user) {
    throw new Error(
      `Superadmin user (${env.SUPERADMIN_EMAIL}) not found — run \`cli seed\` first.`,
    );
  }

  let password: string;
  if (chosen === undefined) {
    password = await generatePassword();
  } else {
    const violations = passwordViolations(await getSystemSetting(PASSWORD_POLICY), chosen);
    if (violations.length > 0) {
      throw new Error(
        `That password does not meet the policy: ${violations.map((v) => v.message).join("; ")}`,
      );
    }
    password = chosen;
  }
  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(password);

  // Replace any existing credential account with a fresh one.
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")));
  await db.insert(accounts).values({
    id: randomUUID(),
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: hash,
  });

  // This path writes the row directly, so better-auth's database hooks never
  // fire. Without this the new password would never age, and would not count
  // against the reuse rule.
  await recordCurrentPassword(user.id);

  return password;
}
