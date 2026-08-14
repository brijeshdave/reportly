// Author: Brijesh Dave <https://github.com/brijeshdave>
// Settings service: typed, validated reads/writes over the settings store with a
// Redis cache and explicit invalidation.
//
// Resolution runs most-specific-first: **user -> company -> system -> registry
// default**. A scope is only consulted when the setting opts into it, so a
// setting that is nobody's business but the installation's cannot accidentally be
// answered by a tenant.
import { ERROR_CODES, type SettingDef, defaultFor } from "@reportly/shared";
import type { z } from "zod";

import { AppError } from "@/core/errors.js";
import { redis } from "@/core/redis.js";
import {
  SYSTEM_OWNER,
  deleteSetting,
  getSettingRow,
  upsertSetting,
  type SettingOwner,
} from "@/core/settings/repo.js";

const CACHE_TTL_SECONDS = 300;

/**
 * The scope is part of the key, not just the id.
 *
 * A user id and a company id are both opaque strings, so keying on the id alone
 * would let one company's value be served to a user whose id happened to match.
 * Unlikely, and not a thing to leave to luck.
 */
function cacheKey(def: SettingDef, owner: SettingOwner): string {
  const id =
    owner.scope === "user" ? owner.userId : owner.scope === "company" ? owner.companyId : "";
  return `settings:${def.namespace}:${def.key}:${owner.scope}:${id}`;
}

async function readCache<S extends z.ZodTypeAny>(
  def: SettingDef<S>,
  owner: SettingOwner,
): Promise<z.infer<S> | null> {
  try {
    const raw = await redis.get(cacheKey(def, owner));
    if (!raw) return null;
    return def.schema.parse(JSON.parse(raw)) as z.infer<S>;
  } catch {
    return null; // cache is best-effort; fall through to the database
  }
}

async function writeCache(def: SettingDef, owner: SettingOwner, value: unknown): Promise<void> {
  try {
    await redis.set(cacheKey(def, owner), JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
  } catch {
    // ignore cache write failures
  }
}

export async function invalidate(
  def: SettingDef,
  owner: SettingOwner = SYSTEM_OWNER,
): Promise<void> {
  try {
    await redis.del(cacheKey(def, owner));
  } catch {
    // ignore
  }
}

/** The system-scoped value (stored value, or the registry default). */
export async function getSystemSetting<S extends z.ZodTypeAny>(
  def: SettingDef<S>,
): Promise<z.infer<S>> {
  const cached = await readCache(def, SYSTEM_OWNER);
  if (cached !== null) return cached;

  const row = await getSettingRow(def.namespace, def.key, SYSTEM_OWNER);
  const value = row ? (def.schema.parse(row.value) as z.infer<S>) : defaultFor(def);
  await writeCache(def, SYSTEM_OWNER, value);
  return value;
}

/** The user's own stored value, or null when they haven't overridden it. */
export async function getUserSetting<S extends z.ZodTypeAny>(
  def: SettingDef<S>,
  userId: string,
): Promise<z.infer<S> | null> {
  const owner: SettingOwner = { scope: "user", userId };
  const cached = await readCache(def, owner);
  if (cached !== null) return cached;
  const row = await getSettingRow(def.namespace, def.key, owner);
  if (!row) return null;
  const value = def.schema.parse(row.value) as z.infer<S>;
  await writeCache(def, owner, value);
  return value;
}

/** A company's own stored value, or null when it has not overridden it. */
export async function getCompanySetting<S extends z.ZodTypeAny>(
  def: SettingDef<S>,
  companyId: string,
): Promise<z.infer<S> | null> {
  const owner: SettingOwner = { scope: "company", companyId };
  const cached = await readCache(def, owner);
  if (cached !== null) return cached;
  const row = await getSettingRow(def.namespace, def.key, owner);
  if (!row) return null;
  const value = def.schema.parse(row.value) as z.infer<S>;
  await writeCache(def, owner, value);
  return value;
}

/**
 * The value that actually applies: user -> company -> system -> default.
 *
 * Each scope is consulted only if the setting opts into it, so passing a company
 * to a setting that is not `companyOverridable` cannot change the answer.
 */
export async function getEffectiveSetting<S extends z.ZodTypeAny>(
  def: SettingDef<S>,
  who: { userId?: string | null; companyId?: string | null } = {},
): Promise<z.infer<S>> {
  if (def.userOverridable && who.userId) {
    const own = await getUserSetting(def, who.userId);
    if (own !== null) return own;
  }
  if (def.companyOverridable && who.companyId) {
    const theirs = await getCompanySetting(def, who.companyId);
    if (theirs !== null) return theirs;
  }
  return getSystemSetting(def);
}

export async function setSystemSetting<S extends z.ZodTypeAny>(
  def: SettingDef<S>,
  input: unknown,
): Promise<z.infer<S>> {
  const parsed = def.schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Invalid value for ${def.namespace}.${def.key}`,
      {
        issues: parsed.error.issues,
      },
    );
  }
  await upsertSetting(def.namespace, def.key, parsed.data, SYSTEM_OWNER);
  await invalidate(def, SYSTEM_OWNER);
  return parsed.data as z.infer<S>;
}

export async function setUserSetting<S extends z.ZodTypeAny>(
  def: SettingDef<S>,
  userId: string,
  input: unknown,
): Promise<z.infer<S>> {
  if (!def.userOverridable) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `${def.namespace}.${def.key} cannot be overridden per user`,
    );
  }
  const parsed = def.schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Invalid value for ${def.namespace}.${def.key}`,
      {
        issues: parsed.error.issues,
      },
    );
  }
  const owner: SettingOwner = { scope: "user", userId };
  await upsertSetting(def.namespace, def.key, parsed.data, owner);
  await invalidate(def, owner);
  return parsed.data as z.infer<S>;
}

/** Set a company's own value. Refused unless the setting opts into company scope. */
export async function setCompanySetting<S extends z.ZodTypeAny>(
  def: SettingDef<S>,
  companyId: string,
  input: unknown,
): Promise<z.infer<S>> {
  if (!def.companyOverridable) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `${def.namespace}.${def.key} cannot be set per company`,
    );
  }
  const parsed = def.schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Invalid value for ${def.namespace}.${def.key}`,
      {
        issues: parsed.error.issues,
      },
    );
  }
  const owner: SettingOwner = { scope: "company", companyId };
  await upsertSetting(def.namespace, def.key, parsed.data, owner);
  await invalidate(def, owner);
  return parsed.data as z.infer<S>;
}

/**
 * Drop a company's override so it follows the system value again.
 *
 * Clearing is not the same as setting the current system value: the second stops
 * following an administrator who later changes it.
 */
export async function clearCompanySetting(def: SettingDef, companyId: string): Promise<void> {
  const owner: SettingOwner = { scope: "company", companyId };
  await deleteSetting(def.namespace, def.key, owner);
  await invalidate(def, owner);
}
