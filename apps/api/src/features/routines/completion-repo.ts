// Author: Brijesh Dave <https://github.com/brijeshdave>
// Data access for routine completions — one person's record of doing an occurrence.
// Start creates the row (in progress); finish stamps the finish time and notes.
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { pointAwards, routineCompletions, routines, users } from "@/core/db/schema.js";

export interface CompletionRow {
  id: string;
  routineId: string;
  occurrenceDate: string;
  userId: string;
  userName: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  notes: string | null;
  awardedPoints: number | null;
}

const withUser = () =>
  db
    .select({
      id: routineCompletions.id,
      routineId: routineCompletions.routineId,
      occurrenceDate: routineCompletions.occurrenceDate,
      userId: routineCompletions.userId,
      userName: users.name,
      status: routineCompletions.status,
      startedAt: routineCompletions.startedAt,
      finishedAt: routineCompletions.finishedAt,
      notes: routineCompletions.notes,
      awardedPoints: routineCompletions.awardedPoints,
    })
    .from(routineCompletions)
    .innerJoin(users, eq(users.id, routineCompletions.userId));

export async function getCompletion(
  routineId: string,
  occurrenceDate: string,
  userId: string,
): Promise<CompletionRow | null> {
  const [row] = await withUser().where(
    and(
      eq(routineCompletions.routineId, routineId),
      eq(routineCompletions.occurrenceDate, occurrenceDate),
      eq(routineCompletions.userId, userId),
    ),
  );
  return row ?? null;
}

export async function getCompletionById(id: string): Promise<CompletionRow | null> {
  const [row] = await withUser().where(eq(routineCompletions.id, id));
  return row ?? null;
}

/** The company a completion belongs to, via its routine — for attachment scoping. */
export async function companyOfCompletion(id: string): Promise<string | null> {
  const [row] = await db
    .select({ companyId: routines.companyId })
    .from(routineCompletions)
    .innerJoin(routines, eq(routines.id, routineCompletions.routineId))
    .where(eq(routineCompletions.id, id));
  return row?.companyId ?? null;
}

/** All completions for a set of routines within [from, to) — the occurrence grid. */
export async function completionsForRoutines(
  routineIds: string[],
  from: string,
  to: string,
): Promise<CompletionRow[]> {
  if (routineIds.length === 0) return [];
  return withUser()
    .where(
      and(
        inArray(routineCompletions.routineId, routineIds),
        gte(routineCompletions.occurrenceDate, from),
        lt(routineCompletions.occurrenceDate, to),
      ),
    )
    .orderBy(asc(routineCompletions.occurrenceDate));
}

export interface AwardableRow {
  completionId: string;
  routineId: string;
  departmentId: string | null;
  userId: string;
  occurrenceDate: string;
  finishedAt: Date | null;
  routinePoints: number;
}

const awardableCols = {
  completionId: routineCompletions.id,
  routineId: routineCompletions.routineId,
  departmentId: routines.departmentId,
  userId: routineCompletions.userId,
  occurrenceDate: routineCompletions.occurrenceDate,
  finishedAt: routineCompletions.finishedAt,
  routinePoints: routines.points,
};

/** Completed occurrences in a month for a set of routines that have not been awarded yet. */
export async function unawardedInMonth(
  routineIds: string[],
  monthStart: string,
  monthEnd: string,
): Promise<AwardableRow[]> {
  if (routineIds.length === 0) return [];
  return db
    .select(awardableCols)
    .from(routineCompletions)
    .innerJoin(routines, eq(routines.id, routineCompletions.routineId))
    .where(
      and(
        inArray(routineCompletions.routineId, routineIds),
        eq(routineCompletions.status, "completed"),
        isNull(routineCompletions.awardedPoints),
        gte(routineCompletions.occurrenceDate, monthStart),
        lt(routineCompletions.occurrenceDate, monthEnd),
      ),
    );
}

/**
 * Every completed-but-unawarded occurrence before a date, for a set of routines — the
 * boot catch-up that awards months a scheduled run may have missed while the server was
 * down. No lower bound, so a long outage is caught up in one pass.
 */
export async function unawardedBefore(
  routineIds: string[],
  beforeDate: string,
): Promise<AwardableRow[]> {
  if (routineIds.length === 0) return [];
  return db
    .select(awardableCols)
    .from(routineCompletions)
    .innerJoin(routines, eq(routines.id, routineCompletions.routineId))
    .where(
      and(
        inArray(routineCompletions.routineId, routineIds),
        eq(routineCompletions.status, "completed"),
        isNull(routineCompletions.awardedPoints),
        lt(routineCompletions.occurrenceDate, beforeDate),
      ),
    );
}

export interface AwardWrite {
  completionId: string;
  routineId: string;
  departmentId: string | null;
  beneficiaryUserId: string;
  earnedOn: string;
  points: number;
}

/** Write routine point-awards and mark their completions, in one transaction (idempotent). */
export async function writeAwards(companyId: string, awards: AwardWrite[]): Promise<void> {
  if (awards.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.insert(pointAwards).values(
      awards.map((a) => ({
        beneficiaryUserId: a.beneficiaryUserId,
        companyId,
        earnedOn: a.earnedOn,
        // Credit the routine's department, so the points land there on the leaderboard.
        departmentId: a.departmentId,
        source: "routine",
        reportId: null,
        routineId: a.routineId,
        kind: "direct",
        depth: 0,
        points: a.points,
      })),
    );
    for (const a of awards) {
      await tx
        .update(routineCompletions)
        .set({ awardedPoints: a.points, updatedAt: new Date() })
        .where(eq(routineCompletions.id, a.completionId));
    }
  });
}

/**
 * Finish (or re-log) a completion with the times the person entered — a routine is often
 * logged after the fact. Upserts, so a finished occurrence can be corrected by logging it
 * again; if no start time is given, the finish time stands in for it.
 */
export async function finishCompletion(
  routineId: string,
  occurrenceDate: string,
  userId: string,
  startedAt: Date | null,
  finishedAt: Date,
  notes: string | null,
): Promise<void> {
  const start = startedAt ?? finishedAt;
  await db
    .insert(routineCompletions)
    .values({
      routineId,
      occurrenceDate,
      userId,
      status: "completed",
      startedAt: start,
      finishedAt,
      notes,
    })
    .onConflictDoUpdate({
      target: [
        routineCompletions.routineId,
        routineCompletions.occurrenceDate,
        routineCompletions.userId,
      ],
      set: { status: "completed", startedAt: start, finishedAt, notes, updatedAt: new Date() },
    });
}
