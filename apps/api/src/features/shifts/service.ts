// Author: Brijesh Dave <https://github.com/brijeshdave>
// The shift catalogue: create/rename/retime shifts a department can be scheduled on.
// Names are unique per company (a duplicate is a 409, caught before the DB so the
// message is friendly). A shift may not start and end at the same minute — a
// zero-length shift is a typo — but an overnight wrap (end before start) is fine and
// left to the schema.
import {
  ERROR_CODES,
  SHIFT_COLORS,
  type CreateShift,
  type Shift,
  type ShiftColor,
  type UpdateShift,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import * as repo from "@/features/shifts/repo.js";
import type { ShiftRow } from "@/features/shifts/repo.js";

const asColor = (value: string): ShiftColor =>
  (SHIFT_COLORS as readonly string[]).includes(value) ? (value as ShiftColor) : "slate";

function serialize(row: ShiftRow): Shift {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    color: asColor(row.color),
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    status: row.status === "disabled" ? "disabled" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const duplicate = (name: string) =>
  new AppError(409, ERROR_CODES.CONFLICT, `A shift named "${name}" already exists`);

export async function listShifts(companyId: string): Promise<Shift[]> {
  return (await repo.listShifts(companyId)).map(serialize);
}

export async function getShift(id: string, companyId: string): Promise<Shift> {
  const row = await repo.getShift(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Shift not found");
  return serialize(row);
}

export async function createShift(companyId: string, input: CreateShift): Promise<Shift> {
  if (await repo.getShiftByName(input.name, companyId)) throw duplicate(input.name);
  const row = await repo.insertShift({
    companyId,
    name: input.name,
    code: input.code,
    color: input.color,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    status: input.status,
  });
  return serialize(row);
}

export async function updateShift(
  id: string,
  companyId: string,
  input: UpdateShift,
): Promise<Shift> {
  const before = await repo.getShift(id, companyId);
  if (!before) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Shift not found");
  if (input.name && input.name !== before.name) {
    const clash = await repo.getShiftByName(input.name, companyId);
    if (clash && clash.id !== id) throw duplicate(input.name);
  }
  const row = await repo.updateShiftRow(id, companyId, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.startMinute !== undefined ? { startMinute: input.startMinute } : {}),
    ...(input.endMinute !== undefined ? { endMinute: input.endMinute } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  });
  return serialize(row!);
}

export async function deleteShift(id: string, companyId: string): Promise<void> {
  const removed = await repo.deleteShiftRow(id, companyId);
  if (!removed) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Shift not found");
}
