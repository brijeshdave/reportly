// Author: Brijesh Dave <https://github.com/brijeshdave>
// Repository for the settings store — the only code that touches the settings
// table. Namespaced, typed-JSON values belonging to the installation, to one
// company, or to one user.
//
// The owner is a discriminated union rather than a scope string beside two
// nullable ids, because three quarters of the combinations those would allow are
// nonsense — a `user` row carrying a company, a `company` row carrying neither.
// This way the impossible ones cannot be written down.
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { settings } from "@/core/db/schema.js";

export type SettingScope = "system" | "user" | "company";

/** Whose value this is. `SYSTEM` is the installation-wide one. */
export type SettingOwner =
  { scope: "system" } | { scope: "user"; userId: string } | { scope: "company"; companyId: string };

export const SYSTEM_OWNER: SettingOwner = { scope: "system" };

export interface SettingRow {
  id: string;
  namespace: string;
  key: string;
  value: unknown;
  scope: string;
  userId: string | null;
  companyId: string | null;
}

/**
 * Both id columns are constrained on every read, not just the one the scope uses.
 *
 * Postgres treats NULLs as distinct in a unique index, so `(namespace, key,
 * scope, user_id, company_id)` does not stop two system rows existing. Pinning
 * the unused column to IS NULL is what keeps a company row from ever being
 * returned as the system one.
 */
function whereSetting(namespace: string, key: string, owner: SettingOwner) {
  const userId = owner.scope === "user" ? owner.userId : null;
  const companyId = owner.scope === "company" ? owner.companyId : null;
  return and(
    eq(settings.namespace, namespace),
    eq(settings.key, key),
    eq(settings.scope, owner.scope),
    userId === null ? isNull(settings.userId) : eq(settings.userId, userId),
    companyId === null ? isNull(settings.companyId) : eq(settings.companyId, companyId),
  );
}

export async function getSettingRow(
  namespace: string,
  key: string,
  owner: SettingOwner = SYSTEM_OWNER,
): Promise<SettingRow | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(whereSetting(namespace, key, owner));
  return row ?? null;
}

export async function listSettings(
  namespace: string,
  scope: SettingScope = "system",
): Promise<SettingRow[]> {
  return db
    .select()
    .from(settings)
    .where(and(eq(settings.namespace, namespace), eq(settings.scope, scope)));
}

/**
 * Insert or update a setting value.
 *
 * Select-then-write rather than `onConflictDoUpdate`: the unique index cannot
 * catch the system row, because its two id columns are NULL and Postgres counts
 * NULLs as distinct. The read above uses the same IS NULL pinning, so it finds
 * the row the index would not.
 */
export async function upsertSetting(
  namespace: string,
  key: string,
  value: unknown,
  owner: SettingOwner = SYSTEM_OWNER,
): Promise<void> {
  const existing = await getSettingRow(namespace, key, owner);
  if (existing) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date() })
      .where(eq(settings.id, existing.id));
    return;
  }
  await db.insert(settings).values({
    namespace,
    key,
    value,
    scope: owner.scope,
    userId: owner.scope === "user" ? owner.userId : null,
    companyId: owner.scope === "company" ? owner.companyId : null,
  });
}

/** Drop an override so the value falls back to the next scope up. */
export async function deleteSetting(
  namespace: string,
  key: string,
  owner: SettingOwner,
): Promise<void> {
  await db.delete(settings).where(whereSetting(namespace, key, owner));
}
