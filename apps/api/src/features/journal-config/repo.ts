// Author: Brijesh Dave <https://github.com/brijeshdave>
// JournalEntry-config repository — the only code touching the severities, journal_statuses
// and categories tables. Three small catalogues that make the reports domain
// org-agnostic.
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { categories, departments, journalStatuses, severities, tags } from "@/core/db/schema.js";
import { TAG_COLORS } from "@reportly/shared";

/* ------------------------------- Severities -------------------------------- */

export interface SeverityRow {
  id: string;
  name: string;
  orderIndex: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listSeverities(): Promise<SeverityRow[]> {
  return db.select().from(severities).orderBy(asc(severities.orderIndex), asc(severities.name));
}

export async function getSeverity(id: string): Promise<SeverityRow | null> {
  const [row] = await db.select().from(severities).where(eq(severities.id, id));
  return row ?? null;
}

export async function insertSeverity(
  fields: Pick<SeverityRow, "name" | "orderIndex" | "status">,
): Promise<SeverityRow> {
  const [row] = await db.insert(severities).values(fields).returning();
  return row!;
}

export async function updateSeverityRow(
  id: string,
  fields: Partial<Pick<SeverityRow, "name" | "orderIndex" | "status">>,
): Promise<SeverityRow | null> {
  const [row] = await db
    .update(severities)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(severities.id, id))
    .returning();
  return row ?? null;
}

export async function deleteSeverityRow(id: string): Promise<void> {
  await db.delete(severities).where(eq(severities.id, id));
}

/* -------------------------------- Statuses --------------------------------- */

export interface StatusRow {
  id: string;
  name: string;
  group: string;
  isTerminal: boolean;
  orderIndex: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function listStatuses(): Promise<StatusRow[]> {
  return db
    .select()
    .from(journalStatuses)
    .orderBy(asc(journalStatuses.orderIndex), asc(journalStatuses.name));
}

/**
 * The first active status in a group, by the order an admin arranged them in.
 *
 * Used for the two defaults — where a report starts, and where one logged against a
 * finished task starts. Chosen by group rather than by name because the catalogue is
 * configurable: an organisation that renames "Open" to "Raised" must not lose its
 * default, and a name lookup would.
 */
export async function firstStatusInGroup(group: string): Promise<StatusRow | null> {
  const [row] = await db
    .select()
    .from(journalStatuses)
    .where(and(eq(journalStatuses.group, group), eq(journalStatuses.status, "active")))
    .orderBy(asc(journalStatuses.orderIndex), asc(journalStatuses.name))
    .limit(1);
  return row ?? null;
}

export async function getStatus(id: string): Promise<StatusRow | null> {
  const [row] = await db.select().from(journalStatuses).where(eq(journalStatuses.id, id));
  return row ?? null;
}

export async function insertStatus(
  fields: Pick<StatusRow, "name" | "group" | "isTerminal" | "orderIndex" | "status">,
): Promise<StatusRow> {
  const [row] = await db.insert(journalStatuses).values(fields).returning();
  return row!;
}

export async function updateStatusRow(
  id: string,
  fields: Partial<Pick<StatusRow, "name" | "group" | "isTerminal" | "orderIndex" | "status">>,
): Promise<StatusRow | null> {
  const [row] = await db
    .update(journalStatuses)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(journalStatuses.id, id))
    .returning();
  return row ?? null;
}

export async function deleteStatusRow(id: string): Promise<void> {
  await db.delete(journalStatuses).where(eq(journalStatuses.id, id));
}

/* ------------------------------- Categories -------------------------------- */

export interface CategoryRowRaw {
  id: string;
  departmentId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  departmentName: string;
}

const categoryCols = {
  id: categories.id,
  departmentId: categories.departmentId,
  name: categories.name,
  description: categories.description,
  status: categories.status,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
  departmentName: departments.name,
};

/** All categories, department name resolved. Optionally narrowed to one department
 * (the report form asks for a department's categories). */
export async function listCategories(departmentId?: string): Promise<CategoryRowRaw[]> {
  const where = departmentId ? eq(categories.departmentId, departmentId) : undefined;
  return db
    .select(categoryCols)
    .from(categories)
    .innerJoin(departments, eq(departments.id, categories.departmentId))
    .where(where)
    .orderBy(asc(departments.name), asc(categories.name));
}

export async function getCategory(id: string): Promise<CategoryRowRaw | null> {
  const [row] = await db
    .select(categoryCols)
    .from(categories)
    .innerJoin(departments, eq(departments.id, categories.departmentId))
    .where(eq(categories.id, id));
  return row ?? null;
}

/** The department must exist (the FK enforces it, but a clean 404 reads better). */
/**
 * Does this department exist **in this company**?
 *
 * The company argument is not optional, and that is the whole point. This used
 * to check existence anywhere on the install, which made it a validity check
 * rather than an authorization one — a caller could name another tenant's
 * department and every guard above passed it through (SF-006). Every caller
 * gates a write on this, so it has to answer "may you use this", not "is this a
 * real uuid".
 */
export async function departmentExists(departmentId: string, companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)));
  return row !== undefined;
}

export async function insertCategory(
  departmentId: string,
  name: string,
  description: string | null,
  status: string,
): Promise<string> {
  const [row] = await db
    .insert(categories)
    .values({ departmentId, name, description, status })
    .returning({ id: categories.id });
  return row!.id;
}

export async function updateCategoryRow(
  id: string,
  fields: Partial<{ name: string; description: string | null; status: string }>,
): Promise<void> {
  await db
    .update(categories)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(categories.id, id));
}

export async function deleteCategoryRow(id: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
}

/** Whether a name is already taken in a department (excluding one id, for updates). */
export async function categoryNameTaken(
  departmentId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.departmentId, departmentId), eq(categories.name, name)));
  return rows.some((row) => row.id !== exceptId);
}

/* --------------------------- Vocabulary import ----------------------------- */

/** The company's departments (id + name), for resolving an import's department names. */
export async function companyDepartments(
  companyId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(eq(departments.companyId, companyId));
}

/** A category with its department name, for one company (export/import matching). */
export async function listCategoriesForCompany(companyId: string): Promise<
  {
    departmentId: string;
    departmentName: string;
    name: string;
    description: string | null;
    status: string;
  }[]
> {
  return db
    .select({
      departmentId: categories.departmentId,
      departmentName: departments.name,
      name: categories.name,
      description: categories.description,
      status: categories.status,
    })
    .from(categories)
    .innerJoin(departments, eq(departments.id, categories.departmentId))
    .where(eq(departments.companyId, companyId))
    .orderBy(asc(departments.name), asc(categories.name));
}

/** A tag with its department name, for one company (export/import matching). */
export async function listTagsForCompany(companyId: string): Promise<
  {
    departmentId: string;
    departmentName: string;
    name: string;
    description: string | null;
    color: string;
    status: string;
  }[]
> {
  return db
    .select({
      departmentId: tags.departmentId,
      departmentName: departments.name,
      name: tags.name,
      description: tags.description,
      color: tags.color,
      status: tags.status,
    })
    .from(tags)
    .innerJoin(departments, eq(departments.id, tags.departmentId))
    .where(eq(departments.companyId, companyId))
    .orderBy(asc(departments.name), asc(tags.name));
}

/** One resolved vocabulary import row — department already resolved to an id. */
export interface ResolvedVocabRow {
  kind: "category" | "tag" | "severity" | "status";
  departmentId: string | null;
  name: string;
  group: string | null;
  terminal: boolean | null;
  color: string | null;
  description: string | null;
  status: string;
}

const lc = (s: string): string => s.trim().toLowerCase();

/**
 * Apply a vocabulary import in one transaction, across all four catalogues. Severities and
 * statuses are company-wide and matched by name; categories and tags are matched by
 * (department, name). An existing term has its per-kind fields updated where the row gives
 * them; a new term is inserted (new severities/statuses appended after the current last).
 * All-or-nothing: a failure rolls the whole import back.
 */
export async function upsertVocabulary(
  companyId: string,
  rows: ResolvedVocabRow[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    const sevRows = await tx.select().from(severities);
    const statRows = await tx.select().from(journalStatuses);
    const catRows = await tx
      .select({ id: categories.id, departmentId: categories.departmentId, name: categories.name })
      .from(categories)
      .innerJoin(departments, eq(departments.id, categories.departmentId))
      .where(eq(departments.companyId, companyId));
    const tagRows = await tx
      .select({ id: tags.id, departmentId: tags.departmentId, name: tags.name })
      .from(tags)
      .innerJoin(departments, eq(departments.id, tags.departmentId))
      .where(eq(departments.companyId, companyId));

    const sevByName = new Map(sevRows.map((s) => [lc(s.name), s.id]));
    const statByName = new Map(statRows.map((s) => [lc(s.name), s.id]));
    const catByKey = new Map(catRows.map((c) => [`${c.departmentId}:${lc(c.name)}`, c.id]));
    const tagByKey = new Map(tagRows.map((t) => [`${t.departmentId}:${lc(t.name)}`, t.id]));
    let nextSevOrder = sevRows.reduce((m, s) => Math.max(m, s.orderIndex), -1) + 1;
    let nextStatOrder = statRows.reduce((m, s) => Math.max(m, s.orderIndex), -1) + 1;

    for (const row of rows) {
      if (row.kind === "severity") {
        const id = sevByName.get(lc(row.name));
        if (id) {
          await tx
            .update(severities)
            .set({
              status: row.status,
              updatedAt: new Date(),
            })
            .where(eq(severities.id, id));
          updated += 1;
        } else {
          await tx.insert(severities).values({
            name: row.name,
            orderIndex: nextSevOrder++,
            status: row.status,
          });
          created += 1;
        }
      } else if (row.kind === "status") {
        const id = statByName.get(lc(row.name));
        if (id) {
          await tx
            .update(journalStatuses)
            .set({
              ...(row.group !== null ? { group: row.group } : {}),
              ...(row.terminal !== null ? { isTerminal: row.terminal } : {}),
              status: row.status,
              updatedAt: new Date(),
            })
            .where(eq(journalStatuses.id, id));
          updated += 1;
        } else {
          await tx.insert(journalStatuses).values({
            name: row.name,
            group: row.group ?? "open",
            isTerminal: row.terminal ?? false,
            orderIndex: nextStatOrder++,
            status: row.status,
          });
          created += 1;
        }
      } else if (row.kind === "category") {
        const key = `${row.departmentId}:${lc(row.name)}`;
        const id = catByKey.get(key);
        if (id) {
          await tx
            .update(categories)
            .set({
              ...(row.description !== null ? { description: row.description } : {}),
              status: row.status,
              updatedAt: new Date(),
            })
            .where(eq(categories.id, id));
          updated += 1;
        } else {
          const [ins] = await tx
            .insert(categories)
            .values({
              departmentId: row.departmentId!,
              name: row.name,
              description: row.description,
              status: row.status,
            })
            .returning({ id: categories.id });
          catByKey.set(key, ins!.id);
          created += 1;
        }
      } else {
        const key = `${row.departmentId}:${lc(row.name)}`;
        const id = tagByKey.get(key);
        if (id) {
          await tx
            .update(tags)
            .set({
              ...(row.color !== null ? { color: row.color } : {}),
              ...(row.description !== null ? { description: row.description } : {}),
              status: row.status,
              updatedAt: new Date(),
            })
            .where(eq(tags.id, id));
          updated += 1;
        } else {
          const [ins] = await tx
            .insert(tags)
            .values({
              departmentId: row.departmentId!,
              name: row.name,
              description: row.description,
              color: row.color ?? TAG_COLORS[0]!,
              status: row.status,
            })
            .returning({ id: tags.id });
          tagByKey.set(key, ins!.id);
          created += 1;
        }
      }
    }
  });
  return { created, updated };
}
