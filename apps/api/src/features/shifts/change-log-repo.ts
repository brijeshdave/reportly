// Author: Brijesh Dave <https://github.com/brijeshdave>
// The schedule change log: writing a row per disturbance to a published schedule, and
// reading them back for the change-history report. Labels are stored resolved, so this
// reads without re-joining the catalogue and stays accurate through a later rename.
import { ENTRY_STATE_CODES } from "@reportly/shared";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import { scheduleChangeLog, users } from "@/core/db/schema.js";

/** A cell as a short human label: the shift name, W/O / L / PH, or "—" for empty. */
export function cellLabel(shiftName: string | null, state: string | null): string {
  if (state === null) return "—";
  if (state === "working") return shiftName ?? "?";
  return ENTRY_STATE_CODES[state as "off" | "leave" | "holiday"] ?? state;
}

export interface NewChange {
  companyId: string;
  scheduleId: string;
  departmentId: string;
  date: string | null;
  subjectUserId: string | null;
  actorUserId: string;
  action: string;
  fromLabel: string | null;
  toLabel: string | null;
  swapId?: string | null;
}

export async function recordChanges(rows: NewChange[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(scheduleChangeLog).values(rows);
}

export interface ChangeLogRow {
  date: string | null;
  subjectName: string | null;
  actorName: string | null;
  action: string;
  fromLabel: string | null;
  toLabel: string | null;
  createdAt: Date;
}

const subject = alias(users, "change_subject");
const actor = alias(users, "change_actor");

/**
 * Cell/swap changes affecting days in [from, to), for a department — the change-history
 * report's rows. Lifecycle events (publish/lock, null date) are left out; they are not
 * per-day changes.
 */
export async function changesForReport(
  companyId: string,
  departmentId: string,
  from: Date,
  to: Date,
): Promise<ChangeLogRow[]> {
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  return db
    .select({
      date: scheduleChangeLog.date,
      subjectName: subject.name,
      actorName: actor.name,
      action: scheduleChangeLog.action,
      fromLabel: scheduleChangeLog.fromLabel,
      toLabel: scheduleChangeLog.toLabel,
      createdAt: scheduleChangeLog.createdAt,
    })
    .from(scheduleChangeLog)
    .leftJoin(subject, eq(subject.id, scheduleChangeLog.subjectUserId))
    .leftJoin(actor, eq(actor.id, scheduleChangeLog.actorUserId))
    .where(
      and(
        eq(scheduleChangeLog.companyId, companyId),
        eq(scheduleChangeLog.departmentId, departmentId),
        gte(scheduleChangeLog.date, fromDate),
        lt(scheduleChangeLog.date, toDate),
      ),
    )
    .orderBy(asc(scheduleChangeLog.date), asc(scheduleChangeLog.createdAt));
}
