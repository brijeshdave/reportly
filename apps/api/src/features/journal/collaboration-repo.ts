// Author: Brijesh Dave <https://github.com/brijeshdave>
// Who holds a report, who worked it, and the trail of it changing hands. The only
// code touching `journal_handovers` and `journal_participants`.
//
// `journal_handovers` has no update or delete path, by the same rule as
// `journal_status_events`: a handover that happened cannot un-happen, and "who was
// responsible at the time" is the question the table exists to answer later.
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import { journalHandovers, journalParticipants, users } from "@/core/db/schema.js";

const fromUser = alias(users, "from_user");
const toUser = alias(users, "to_user");
const byUser = alias(users, "by_user");
const participant = alias(users, "participant");
const adder = alias(users, "adder");

export interface HandoverRowRaw {
  id: string;
  reportId: string;
  fromUserId: string | null;
  fromUserName: string | null;
  toUserId: string | null;
  toUserName: string | null;
  byUserId: string;
  byUserName: string;
  reason: string | null;
  handedAt: Date;
}

export async function insertHandover(values: {
  reportId: string;
  fromUserId: string | null;
  toUserId: string | null;
  byUserId: string;
  reason: string | null;
}): Promise<void> {
  await db.insert(journalHandovers).values(values);
}

/** One report's handovers, oldest first — the order the story happened in. */
export async function handoversFor(reportId: string): Promise<HandoverRowRaw[]> {
  return (
    db
      .select({
        id: journalHandovers.id,
        reportId: journalHandovers.reportId,
        fromUserId: journalHandovers.fromUserId,
        fromUserName: fromUser.name,
        toUserId: journalHandovers.toUserId,
        toUserName: toUser.name,
        byUserId: journalHandovers.byUserId,
        byUserName: byUser.name,
        reason: journalHandovers.reason,
        handedAt: journalHandovers.handedAt,
      })
      .from(journalHandovers)
      .innerJoin(byUser, eq(byUser.id, journalHandovers.byUserId))
      // Left joins: the two ends are set-null, so a departed colleague leaves the
      // handover readable with a missing name rather than dropping the row.
      .leftJoin(fromUser, eq(fromUser.id, journalHandovers.fromUserId))
      .leftJoin(toUser, eq(toUser.id, journalHandovers.toUserId))
      .where(eq(journalHandovers.reportId, reportId))
      .orderBy(asc(journalHandovers.handedAt))
  );
}

export interface ParticipantRowRaw {
  userId: string;
  userName: string;
  addedById: string;
  addedByName: string;
  addedAt: Date;
}

export async function participantsFor(reportId: string): Promise<ParticipantRowRaw[]> {
  return db
    .select({
      userId: journalParticipants.userId,
      userName: participant.name,
      addedById: journalParticipants.addedBy,
      addedByName: adder.name,
      addedAt: journalParticipants.addedAt,
    })
    .from(journalParticipants)
    .innerJoin(participant, eq(participant.id, journalParticipants.userId))
    .innerJoin(adder, eq(adder.id, journalParticipants.addedBy))
    .where(eq(journalParticipants.reportId, reportId))
    .orderBy(asc(journalParticipants.addedAt));
}

/**
 * Replace the participant list wholesale — the membership, not the points.
 *
 * `addedBy` and `addedAt` are re-stamped for everyone on each save, which is the
 * honest reading: the list is a statement of who worked this, made by whoever last
 * edited it, not an append-only log. The handover trail is where "who did what
 * when" is recorded immutably.
 */
export async function setParticipants(
  reportId: string,
  people: { userId: string }[],
  addedBy: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(journalParticipants).where(eq(journalParticipants.reportId, reportId));
    if (people.length === 0) return;
    // Dedupe: somebody listed twice is one member, not a primary-key failure.
    const ids = [...new Set(people.map((p) => p.userId))];
    await tx
      .insert(journalParticipants)
      .values(ids.map((userId) => ({ reportId, userId, addedBy })))
      .onConflictDoNothing();
  });
}

/** Put the author on the record as a participant when the report is created, so the
 *  scoring grid has no special case for them — they are the first worker. */
export async function addAuthorAsParticipant(reportId: string, authorId: string): Promise<void> {
  await db
    .insert(journalParticipants)
    .values({ reportId, userId: authorId, addedBy: authorId })
    .onConflictDoNothing();
}

/** Put several people on the record at once, added by the author. Used when an entry
 *  is filed against a task: everybody who worked the task starts on the entry, so the
 *  author divides the points across them rather than retyping the list. */
export async function addParticipants(
  reportId: string,
  userIds: string[],
  addedBy: string,
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  await db
    .insert(journalParticipants)
    .values(ids.map((userId) => ({ reportId, userId, addedBy })))
    .onConflictDoNothing();
}
