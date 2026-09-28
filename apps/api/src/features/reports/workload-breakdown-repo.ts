// Author: Brijesh Dave <https://github.com/brijeshdave>
// What each person's work *was*, not just how much of it there was: a tally per
// person per severity, and per person per category.
//
// The flat workload report answers "how much did this person do". Asked for from
// use: "also need a same report with severity wise for all users, one with category
// wise for all users" — because ten Critical breakdowns and ten Informational ones
// are the same number and a different month.
//
// Counted in Postgres, one row per person per bucket, for the reason the rest of
// this folder gives: fetching every entry for a year and adding them up in TypeScript
// is a data dump wearing a report's clothes.
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { categories, departments, journalEntries, severities } from "@/core/db/schema.js";

/** One person's count in one bucket. `bucketId` is null for entries with none. */
export interface BucketCount {
  userId: string;
  bucketId: string | null;
  n: number;
}

/** A tally that also says what kind of entry it counted. */
export interface SeverityCount extends BucketCount {
  kind: string;
}

/**
 * Every submitted entry per person per severity, **with its kind**.
 *
 * Counting issues alone was wrong and quietly so. Completing a task opens a journal
 * entry, and the server forces that entry to be a **work log** — which has no
 * severity by design, because "nothing broke here, this is what I did" has nothing to
 * rate. So a person who wrote up thirty tasks and raised two breakdowns appeared on
 * this report as two, and the thirty were nowhere.
 *
 * The kind travels with the count so the report can put those in a column of their
 * own rather than either dropping them or dumping them into "not set" beside issues
 * that are genuinely missing a severity. Those two are different problems: one is how
 * the product works, the other is a record somebody needs to fix.
 *
 * Routines are not here at all, and should not be: a routine completion is its own
 * table and never becomes a journal entry.
 */
export async function entriesBySeverity(
  userIds: string[],
  companyId: string,
  from: Date,
  to: Date,
): Promise<SeverityCount[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      userId: journalEntries.authorId,
      bucketId: journalEntries.severityId,
      kind: journalEntries.kind,
      n: sql<number>`count(*)::int`,
    })
    .from(journalEntries)
    .where(
      and(
        inArray(journalEntries.authorId, userIds),
        eq(journalEntries.companyId, companyId),
        // Drafts are private and unfinished; counting them would credit work that
        // nobody else can see and that may never be filed.
        eq(journalEntries.state, "submitted"),
        gte(journalEntries.reportDate, from),
        lt(journalEntries.reportDate, to),
      ),
    )
    .groupBy(journalEntries.authorId, journalEntries.severityId, journalEntries.kind);
}

/**
 * Every submitted entry per person per category, both kinds.
 *
 * Unlike severity, a category fits a work log as well as an issue — "what kind of
 * thing was this" is a question about the job, not about how badly it went.
 */
export async function entriesByCategory(
  userIds: string[],
  companyId: string,
  from: Date,
  to: Date,
): Promise<BucketCount[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      userId: journalEntries.authorId,
      bucketId: journalEntries.categoryId,
      n: sql<number>`count(*)::int`,
    })
    .from(journalEntries)
    .where(
      and(
        inArray(journalEntries.authorId, userIds),
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.state, "submitted"),
        gte(journalEntries.reportDate, from),
        lt(journalEntries.reportDate, to),
      ),
    )
    .groupBy(journalEntries.authorId, journalEntries.categoryId);
}

/** One column of a breakdown: the thing being counted into. */
export interface Bucket {
  id: string;
  name: string;
  /** Only categories have one; used to tell two same-named categories apart. */
  departmentName?: string;
}

/**
 * The severity ladder, worst last.
 *
 * In the ladder's own order rather than alphabetically, because the order is the
 * meaning: a row reading left to right is a person's work getting more serious.
 */
export async function severityBuckets(): Promise<Bucket[]> {
  return db
    .select({ id: severities.id, name: severities.name })
    .from(severities)
    .orderBy(asc(severities.orderIndex), asc(severities.name));
}

/** Every category in the company, with the department that owns it. */
export async function categoryBuckets(companyId: string): Promise<Bucket[]> {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      departmentName: departments.name,
    })
    .from(categories)
    .innerJoin(departments, eq(departments.id, categories.departmentId))
    .where(eq(departments.companyId, companyId))
    .orderBy(asc(departments.name), asc(categories.name));
}
