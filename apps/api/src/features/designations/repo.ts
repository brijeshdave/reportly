// Author: Brijesh Dave <https://github.com/brijeshdave>
// Designation repository — the only code touching the designations table.
import { eq, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { designations, users } from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import type { ResolvedListQuery } from "@reportly/shared";

export interface DesignationRowRaw {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  userCount: number;
}

const cols = {
  id: designations.id,
  name: designations.name,
  status: designations.status,
  createdAt: designations.createdAt,
  updatedAt: designations.updatedAt,
};

const listConfig: ListConfig = {
  columns: {
    name: designations.name,
    status: designations.status,
    createdAt: designations.createdAt,
  },
  defaultSort: designations.name,
};

/** The head-count is a LEFT JOIN, so a title nobody holds still lists — with a
 * zero, which is exactly the thing you want to see before retiring it. */
export async function listDesignations(
  query: ResolvedListQuery,
): Promise<{ rows: DesignationRowRaw[]; total: number }> {
  const { where, orderBy, limit, offset } = buildListParts(listConfig, query);

  const rows = await db
    .select({ ...cols, userCount: sql<number>`count(${users.id})::int` })
    .from(designations)
    .leftJoin(users, eq(users.designationId, designations.id))
    .where(where)
    .groupBy(designations.id)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const counted = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(designations)
    .where(where);

  return { rows, total: counted[0]?.count ?? 0 };
}

/** Every active designation, for the picker on a user's profile. */
export async function activeDesignations(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: designations.id, name: designations.name })
    .from(designations)
    .where(eq(designations.status, "active"))
    .orderBy(designations.name);
}

export async function getDesignation(id: string): Promise<DesignationRowRaw | null> {
  const [row] = await db
    .select({ ...cols, userCount: sql<number>`count(${users.id})::int` })
    .from(designations)
    .leftJoin(users, eq(users.designationId, designations.id))
    .where(eq(designations.id, id))
    .groupBy(designations.id);
  return row ?? null;
}

export async function insertDesignation(name: string, status: string): Promise<DesignationRowRaw> {
  const [row] = await db.insert(designations).values({ name, status }).returning(cols);
  return { ...row!, userCount: 0 };
}

export async function updateDesignationRow(
  id: string,
  fields: Partial<{ name: string; status: string }>,
): Promise<void> {
  await db
    .update(designations)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(designations.id, id));
}

export async function deleteDesignationRow(id: string): Promise<void> {
  await db.delete(designations).where(eq(designations.id, id));
}
