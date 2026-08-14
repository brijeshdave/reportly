// Author: Brijesh Dave <https://github.com/brijeshdave>
// The department-owned vocabulary: device types and tags. The only code touching
// those two tables.
//
// They live together because they are the same shape — a per-department catalogue
// with a name, a description and an active flag, unique within its department —
// and splitting them into two identical modules would mean two places to fix the
// next time the shape changes. Categories predate this and stay in report-config;
// they are the third instance of the pattern, and if a fourth appears, all four
// should be generalised rather than copied again.
import { type SQL, and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { departments, deviceTypes, devices, tags, taggables } from "@/core/db/schema.js";

export interface VocabularyRowRaw {
  id: string;
  departmentId: string;
  departmentName: string;
  /** The owning company, through the department. Selected so a read or a write
   *  by id can be refused when it belongs to somebody else — see SF-009. */
  companyId: string;
  name: string;
  description: string | null;
  /** Tags only; device types have no colour, so this is null for them. */
  color?: string | null;
  /** Device types only: whether an outage on one stops production. */
  tracksDowntime?: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/* ------------------------------- device types ------------------------------ */

const deviceTypeCols = {
  id: deviceTypes.id,
  departmentId: deviceTypes.departmentId,
  departmentName: departments.name,
  companyId: departments.companyId,
  name: deviceTypes.name,
  description: deviceTypes.description,
  tracksDowntime: deviceTypes.tracksDowntime,
  status: deviceTypes.status,
  createdAt: deviceTypes.createdAt,
  updatedAt: deviceTypes.updatedAt,
};

/**
 * The company's device types, optionally narrowed to one of its departments.
 *
 * `companyId` is REQUIRED and always filtered on. It used to be absent entirely,
 * and `departmentId` was optional with "no department" meaning no WHERE clause at
 * all — so an unfiltered call returned every department of every company on the
 * install (SF-006). Optional-means-everything is the wrong default for anything
 * a tenant can reach.
 */
export async function listDeviceTypes(
  companyId: string,
  departmentId?: string,
): Promise<VocabularyRowRaw[]> {
  const where = departmentId
    ? and(eq(departments.companyId, companyId), eq(deviceTypes.departmentId, departmentId))
    : eq(departments.companyId, companyId);
  return db
    .select(deviceTypeCols)
    .from(deviceTypes)
    .innerJoin(departments, eq(departments.id, deviceTypes.departmentId))
    .where(where)
    .orderBy(asc(departments.name), asc(deviceTypes.name));
}

export async function getDeviceType(id: string): Promise<VocabularyRowRaw | null> {
  const [row] = await db
    .select(deviceTypeCols)
    .from(deviceTypes)
    .innerJoin(departments, eq(departments.id, deviceTypes.departmentId))
    .where(eq(deviceTypes.id, id));
  return row ?? null;
}

export async function insertDeviceType(values: {
  departmentId: string;
  name: string;
  description: string | null;
  tracksDowntime: boolean;
  status: string;
}): Promise<string> {
  const [row] = await db.insert(deviceTypes).values(values).returning({ id: deviceTypes.id });
  return row!.id;
}

export async function updateDeviceTypeRow(
  id: string,
  fields: Partial<{
    name: string;
    description: string | null;
    tracksDowntime: boolean;
    status: string;
  }>,
): Promise<void> {
  await db
    .update(deviceTypes)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(deviceTypes.id, id));
}

export async function deleteDeviceTypeRow(id: string): Promise<void> {
  await db.delete(deviceTypes).where(eq(deviceTypes.id, id));
}

/** How many devices hold this type — what a delete would silently un-label. */
export async function deviceTypeInUse(id: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(eq(devices.typeId, id));
  return row?.count ?? 0;
}

/* ----------------------------------- tags ---------------------------------- */

const tagCols = {
  id: tags.id,
  departmentId: tags.departmentId,
  departmentName: departments.name,
  companyId: departments.companyId,
  name: tags.name,
  description: tags.description,
  color: tags.color,
  status: tags.status,
  createdAt: tags.createdAt,
  updatedAt: tags.updatedAt,
};

/** The company's tags, optionally narrowed to one of its departments. See the
 *  note on `listDeviceTypes` — `companyId` is required for the same reason. */
export async function listTags(
  companyId: string,
  departmentId?: string,
): Promise<VocabularyRowRaw[]> {
  const where = departmentId
    ? and(eq(departments.companyId, companyId), eq(tags.departmentId, departmentId))
    : eq(departments.companyId, companyId);
  return db
    .select(tagCols)
    .from(tags)
    .innerJoin(departments, eq(departments.id, tags.departmentId))
    .where(where)
    .orderBy(asc(departments.name), asc(tags.name));
}

export async function getTag(id: string): Promise<VocabularyRowRaw | null> {
  const [row] = await db
    .select(tagCols)
    .from(tags)
    .innerJoin(departments, eq(departments.id, tags.departmentId))
    .where(eq(tags.id, id));
  return row ?? null;
}

export async function insertTag(values: {
  departmentId: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
}): Promise<string> {
  const [row] = await db.insert(tags).values(values).returning({ id: tags.id });
  return row!.id;
}

export async function updateTagRow(
  id: string,
  fields: Partial<{ name: string; description: string | null; color: string; status: string }>,
): Promise<void> {
  await db
    .update(tags)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(tags.id, id));
}

export async function deleteTagRow(id: string): Promise<void> {
  await db.delete(tags).where(eq(tags.id, id));
}

/** How many records carry this tag — what a delete would strip off them. */
export async function tagInUse(id: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taggables)
    .where(eq(taggables.tagId, id));
  return row?.count ?? 0;
}

/* ------------------------------- tag links --------------------------------- */

/** The tags on one record, name-resolved, for the detail read. */
export async function tagsFor(
  ownerType: string,
  ownerId: string,
): Promise<{ id: string; name: string; color: string }[]> {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(taggables)
    .innerJoin(tags, eq(tags.id, taggables.tagId))
    .where(and(eq(taggables.ownerType, ownerType), eq(taggables.ownerId, ownerId)))
    .orderBy(asc(tags.name));
}

/** The tags on many records at once — so a list page costs one query, not one per row. */
export async function tagsForMany(
  ownerType: string,
  ownerIds: string[],
): Promise<Map<string, { id: string; name: string; color: string }[]>> {
  const byOwner = new Map<string, { id: string; name: string; color: string }[]>();
  if (ownerIds.length === 0) return byOwner;

  const rows = await db
    .select({ ownerId: taggables.ownerId, id: tags.id, name: tags.name, color: tags.color })
    .from(taggables)
    .innerJoin(tags, eq(tags.id, taggables.tagId))
    .where(and(eq(taggables.ownerType, ownerType), inArray(taggables.ownerId, ownerIds)))
    .orderBy(asc(tags.name));

  for (const row of rows) {
    const list = byOwner.get(row.ownerId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    byOwner.set(row.ownerId, list);
  }
  return byOwner;
}

/**
 * Replace a record's tags wholesale. Called only when the caller actually sent a
 * tag list — an edit that never mentions tags must not clear them, which is the
 * same rule the report's scope targets follow.
 */
export async function setTags(ownerType: string, ownerId: string, tagIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(taggables)
      .where(and(eq(taggables.ownerType, ownerType), eq(taggables.ownerId, ownerId)));
    if (tagIds.length === 0) return;
    await tx
      .insert(taggables)
      .values([...new Set(tagIds)].map((tagId) => ({ tagId, ownerType, ownerId })))
      .onConflictDoNothing();
  });
}

/** Drop every tag link for a record — used when the record itself is deleted. */
export async function clearTags(ownerType: string, ownerId: string): Promise<void> {
  await db
    .delete(taggables)
    .where(and(eq(taggables.ownerType, ownerType), eq(taggables.ownerId, ownerId)));
}

/**
 * Which of these tag ids exist, are active, and belong to the given department.
 * The service uses it to refuse a tag from another department rather than silently
 * dropping it — a tag that vanishes without comment looks like a bug in saving.
 */
export async function validTagIds(departmentId: string, tagIds: string[]): Promise<Set<string>> {
  if (tagIds.length === 0) return new Set();
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(eq(tags.departmentId, departmentId), eq(tags.status, "active"), inArray(tags.id, tagIds)),
    );
  return new Set(rows.map((r) => r.id));
}

/** The colours already in use in a department — so a new tag can avoid them. */
export async function colorsInUse(departmentId: string): Promise<Set<string>> {
  const rows = await db
    .select({ color: tags.color })
    .from(tags)
    .where(eq(tags.departmentId, departmentId));
  return new Set(rows.map((r) => r.color));
}

/** Name uniqueness within a department, for the 409 rather than a 500. */
export async function nameTaken(
  table: "device_types" | "tags",
  departmentId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const t = table === "tags" ? tags : deviceTypes;
  const notSelf: SQL | undefined = exceptId ? ne(t.id, exceptId) : undefined;
  const [row] = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.departmentId, departmentId), eq(t.name, name), notSelf));
  return Boolean(row);
}
