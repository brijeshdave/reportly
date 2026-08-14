// Author: Brijesh Dave <https://github.com/brijeshdave>
// Data access for the shift catalogue: company-scoped rows, ordered so the calendar
// and the pickers read them the same way (earliest start first). The per-department
// scheduling that reads these lives in its own repo alongside this one later.
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { shifts } from "@/core/db/schema.js";

export interface ShiftRow {
  id: string;
  name: string;
  code: string;
  color: string;
  startMinute: number;
  endMinute: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const cols = {
  id: shifts.id,
  name: shifts.name,
  code: shifts.code,
  color: shifts.color,
  startMinute: shifts.startMinute,
  endMinute: shifts.endMinute,
  status: shifts.status,
  createdAt: shifts.createdAt,
  updatedAt: shifts.updatedAt,
};

/** Every shift in the company, earliest start first (then name), for lists and pickers. */
export async function listShifts(companyId: string): Promise<ShiftRow[]> {
  return db
    .select(cols)
    .from(shifts)
    .where(eq(shifts.companyId, companyId))
    .orderBy(asc(shifts.startMinute), asc(shifts.name));
}

export async function getShift(id: string, companyId: string): Promise<ShiftRow | null> {
  const [row] = await db
    .select(cols)
    .from(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.companyId, companyId)));
  return row ?? null;
}

export async function getShiftByName(name: string, companyId: string): Promise<ShiftRow | null> {
  const [row] = await db
    .select(cols)
    .from(shifts)
    .where(and(eq(shifts.name, name), eq(shifts.companyId, companyId)));
  return row ?? null;
}

export interface NewShift {
  companyId: string;
  name: string;
  code: string;
  color: string;
  startMinute: number;
  endMinute: number;
  status: string;
}

export async function insertShift(fields: NewShift): Promise<ShiftRow> {
  const [row] = await db.insert(shifts).values(fields).returning(cols);
  return row!;
}

export async function updateShiftRow(
  id: string,
  companyId: string,
  fields: Partial<
    Pick<ShiftRow, "name" | "code" | "color" | "startMinute" | "endMinute" | "status">
  >,
): Promise<ShiftRow | null> {
  const [row] = await db
    .update(shifts)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(shifts.id, id), eq(shifts.companyId, companyId)))
    .returning(cols);
  return row ?? null;
}

export async function deleteShiftRow(id: string, companyId: string): Promise<boolean> {
  const rows = await db
    .delete(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.companyId, companyId)))
    .returning({ id: shifts.id });
  return rows.length > 0;
}
