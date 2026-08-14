// Author: Brijesh Dave <https://github.com/brijeshdave>
// Company repository — the only code touching the companies table (+ the location
// row auto-created with each company). Services call these; nothing else.
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { companies, locations, userCompanies, users } from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import type { ResolvedListQuery } from "@reportly/shared";

export interface CompanyRow {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Something a company delete would destroy or detach. */
export interface CompanyReference {
  id: string;
  name: string;
}

const listConfig: ListConfig = {
  columns: { name: companies.name, status: companies.status, createdAt: companies.createdAt },
  defaultSort: companies.name,
};

/** Companies the user has been given; superadmins reach them all. */
function accessScope(userId: string | null): SQL | undefined {
  if (userId === null) return undefined;
  return inArray(
    companies.id,
    db
      .select({ id: userCompanies.companyId })
      .from(userCompanies)
      .where(eq(userCompanies.userId, userId)),
  );
}

/** Pass `userId: null` for a superadmin, who sees every company. */
export async function listCompanies(
  query: ResolvedListQuery,
  userId: string | null,
): Promise<{ rows: CompanyRow[]; total: number }> {
  const { where, orderBy, limit, offset } = buildListParts(listConfig, query);
  const scoped = and(where, accessScope(userId));

  const rows = await db
    .select()
    .from(companies)
    .where(scoped)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
  const counted = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .where(scoped);

  return { rows, total: counted[0]?.count ?? 0 };
}

export async function getCompanyById(id: string): Promise<CompanyRow | null> {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  return row ?? null;
}

/** Create a company and its mandatory, immutable "Remote" location atomically. */
export async function createCompanyWithRemote(name: string): Promise<CompanyRow> {
  return db.transaction(async (tx) => {
    const [company] = await tx.insert(companies).values({ name }).returning();
    await tx.insert(locations).values({ companyId: company!.id, name: "Remote", isRemote: true });
    return company!;
  });
}

export async function updateCompanyName(id: string, name: string): Promise<CompanyRow | null> {
  const [row] = await db
    .update(companies)
    .set({ name, updatedAt: new Date() })
    .where(eq(companies.id, id))
    .returning();
  return row ?? null;
}

export async function deleteCompanyById(id: string): Promise<void> {
  // FKs cascade to locations, group_companies, group_locations.
  await db.delete(companies).where(eq(companies.id, id));
}

export async function updateCompanyStatus(
  id: string,
  status: "active" | "inactive",
): Promise<CompanyRow | null> {
  const [row] = await db
    .update(companies)
    .set({ status, updatedAt: new Date() })
    .where(eq(companies.id, id))
    .returning();
  return row ?? null;
}

/** Locations this company owns. Deleting the company deletes all of them. */
export async function locationsOf(companyId: string): Promise<CompanyReference[]> {
  return db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(eq(locations.companyId, companyId))
    .orderBy(locations.name);
}

/** People given this company. They lose access to it when it is deleted. */
export async function groupsScopedTo(companyId: string): Promise<CompanyReference[]> {
  return db
    .select({ id: users.id, name: users.name })
    .from(userCompanies)
    .innerJoin(users, eq(users.id, userCompanies.userId))
    .where(eq(userCompanies.companyId, companyId))
    .orderBy(users.name);
}
