// Author: Brijesh Dave <https://github.com/brijeshdave>
// The only code touching `journal_status_events` — the append-only record of every
// move a report's status made. There is deliberately no update and no delete: a
// transition that happened cannot un-happen, and the reliability figures derived
// from these rows are only trustworthy if nothing can quietly rewrite them. Same
// reasoning as the point_awards ledger.
import { asc, eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { journalStatusEvents, journalStatuses, users } from "@/core/db/schema.js";
import { alias } from "drizzle-orm/pg-core";

const fromStatus = alias(journalStatuses, "from_status");
const toStatus = alias(journalStatuses, "to_status");

export interface StatusEventRaw {
  id: string;
  reportId: string;
  fromStatusId: string | null;
  fromStatusName: string | null;
  toStatusId: string | null;
  toStatusName: string | null;
  toGroup: string | null;
  /** Null when the status was retired out from under the event (set-null). An
   *  unknown status is not a terminal one — the timing rules treat it as false. */
  toIsTerminal: boolean | null;
  changedById: string;
  changedByName: string;
  changedAt: Date;
}

/**
 * Append one transition. Called at creation (`fromStatusId` null) and on every
 * status change.
 *
 * `toIsTerminal` and the group are **not** copied onto the row: they are looked up
 * from `journal_statuses` on read. An admin who corrects a status's terminal flag
 * must correct history along with it — a snapshot here would leave the report's
 * timeline disagreeing with the status catalogue forever, and the catalogue is the
 * thing people can actually see and reason about.
 */
export async function insertStatusEvent(fields: {
  reportId: string;
  fromStatusId: string | null;
  toStatusId: string | null;
  changedBy: string;
}): Promise<void> {
  await db.insert(journalStatusEvents).values(fields);
}

/** One report's transitions, oldest first — the order every timing rule assumes. */
export async function statusEventsFor(reportId: string): Promise<StatusEventRaw[]> {
  return db
    .select({
      id: journalStatusEvents.id,
      reportId: journalStatusEvents.reportId,
      fromStatusId: journalStatusEvents.fromStatusId,
      fromStatusName: fromStatus.name,
      toStatusId: journalStatusEvents.toStatusId,
      toStatusName: toStatus.name,
      toGroup: toStatus.group,
      toIsTerminal: toStatus.isTerminal,
      changedById: journalStatusEvents.changedBy,
      changedByName: users.name,
      changedAt: journalStatusEvents.changedAt,
    })
    .from(journalStatusEvents)
    .innerJoin(users, eq(users.id, journalStatusEvents.changedBy))
    .leftJoin(fromStatus, eq(fromStatus.id, journalStatusEvents.fromStatusId))
    .leftJoin(toStatus, eq(toStatus.id, journalStatusEvents.toStatusId))
    .where(eq(journalStatusEvents.reportId, reportId))
    .orderBy(asc(journalStatusEvents.changedAt));
}
