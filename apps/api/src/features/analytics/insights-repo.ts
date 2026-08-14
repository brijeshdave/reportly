// Author: Brijesh Dave <https://github.com/brijeshdave>
// The aggregations behind the Insights charts.
//
// Every one is a GROUP BY over facts the app already stores, shaped as
// `{ label, value }` series the client can draw without arithmetic. The chart
// does no maths: a component that computes its own numbers is a second
// definition of a figure the reports already answer, and the two drift.
//
// Company-scoped throughout — `companyId` is required on every function, not
// optional, for the reason SF-006 exists.
import { and, asc, count, desc, eq, gte, isNotNull, lte, sql, sum } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  assets,
  categories,
  departments,
  downtimeEntries,
  journalEntries,
  pointAwards,
  users,
} from "@/core/db/schema.js";

export interface Point {
  label: string;
  value: number;
}

/**
 * Entries over time, bucketed to suit the window.
 *
 * The bucket is chosen from the window's length, not fixed at a day. A day is the
 * obvious unit and the wrong one past a few weeks: on a quarter of real data most
 * days hold nought or one entry, and the line becomes a sawtooth between 0 and 1
 * that shows the sampling rate rather than the trend. Weekly and monthly buckets
 * are how you see the shape the reader came for.
 *
 * `date_trunc` then formatted back to YYYY-MM-DD, so the client keeps one date
 * format and does not need to know which bucket it got.
 */
function bucketOf(from: Date, to: Date): "day" | "week" | "month" {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 31) return "day";
  if (days <= 180) return "week";
  return "month";
}

export async function issuesOverTime(
  companyId: string,
  from: Date,
  to: Date,
): Promise<{ label: string; issues: number; work: number }[]> {
  const bucket = bucketOf(from, to);
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc(${bucket}, ${journalEntries.reportDate}), 'YYYY-MM-DD')`,
      kind: journalEntries.kind,
      n: count(),
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        gte(journalEntries.reportDate, from),
        lte(journalEntries.reportDate, to),
      ),
    )
    .groupBy(sql`1`, journalEntries.kind)
    .orderBy(asc(sql`1`));

  // Fold the two kinds into one row per day. Two series on ONE axis — both are
  // counts of entries, so they share a scale honestly.
  const byDay = new Map<string, { label: string; issues: number; work: number }>();
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { label: row.day, issues: 0, work: 0 };
    if (row.kind === "issue") entry.issues += row.n;
    else entry.work += row.n;
    byDay.set(row.day, entry);
  }
  return [...byDay.values()];
}

/** Issue counts per category — what kind of thing keeps going wrong. */
export async function issuesByCategory(companyId: string, from: Date, to: Date): Promise<Point[]> {
  const rows = await db
    .select({ label: categories.name, value: count() })
    .from(journalEntries)
    .innerJoin(categories, eq(categories.id, journalEntries.categoryId))
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.kind, "issue"),
        gte(journalEntries.reportDate, from),
        lte(journalEntries.reportDate, to),
      ),
    )
    .groupBy(categories.name)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/**
 * Minutes of downtime per asset, worst first.
 *
 * Closed spans only. An open one has no end, so counting it would mean choosing a
 * number — "now" — that changes every time the page is refreshed, and a bar that
 * grows while you look at it is not a measurement.
 */
export async function downtimeByAsset(
  companyId: string,
  from: Date,
  to: Date,
  limit = 8,
): Promise<Point[]> {
  const minutes = sql<number>`sum(extract(epoch from (${downtimeEntries.endedAt} - ${downtimeEntries.startedAt})) / 60)`;
  const rows = await db
    .select({ label: assets.name, value: minutes })
    .from(downtimeEntries)
    .innerJoin(
      assets,
      and(eq(assets.id, sql`${downtimeEntries.targetId}::uuid`), eq(assets.companyId, companyId)),
    )
    .where(
      and(
        eq(downtimeEntries.companyId, companyId),
        eq(downtimeEntries.targetKind, "asset"),
        isNotNull(downtimeEntries.endedAt),
        gte(downtimeEntries.startedAt, from),
        lte(downtimeEntries.startedAt, to),
      ),
    )
    .groupBy(assets.name)
    .orderBy(desc(minutes))
    .limit(limit);
  return rows.map((r) => ({ label: r.label, value: Math.round(Number(r.value)) }));
}

/** Points per person, highest first — the leaderboard's shape, drawn. */
export async function pointsByPerson(
  companyId: string,
  from: Date,
  to: Date,
  limit = 10,
): Promise<Point[]> {
  const rows = await db
    .select({ label: users.name, value: sum(pointAwards.points) })
    .from(pointAwards)
    .innerJoin(users, eq(users.id, pointAwards.beneficiaryUserId))
    .where(
      and(
        eq(pointAwards.companyId, companyId),
        eq(pointAwards.kind, "direct"),
        gte(pointAwards.earnedOn, from.toISOString().slice(0, 10)),
        lte(pointAwards.earnedOn, to.toISOString().slice(0, 10)),
      ),
    )
    .groupBy(users.name)
    .orderBy(desc(sum(pointAwards.points)))
    .limit(limit);
  return rows.map((r) => ({ label: r.label, value: Number(r.value ?? 0) }));
}

/** Points per department — where the work is happening, not who did it. */
export async function pointsByDepartment(
  companyId: string,
  from: Date,
  to: Date,
): Promise<Point[]> {
  const rows = await db
    .select({ label: departments.name, value: sum(pointAwards.points) })
    .from(pointAwards)
    .innerJoin(departments, eq(departments.id, pointAwards.departmentId))
    .where(
      and(
        eq(pointAwards.companyId, companyId),
        eq(pointAwards.kind, "direct"),
        gte(pointAwards.earnedOn, from.toISOString().slice(0, 10)),
        lte(pointAwards.earnedOn, to.toISOString().slice(0, 10)),
      ),
    )
    .groupBy(departments.name)
    .orderBy(desc(sum(pointAwards.points)));
  return rows.map((r) => ({ label: r.label, value: Number(r.value ?? 0) }));
}

/** Entries per status — how much is open versus finished. */
export async function entriesByStatus(companyId: string, from: Date, to: Date): Promise<Point[]> {
  const rows = await db
    .select({
      label: sql<string>`coalesce(${sql.raw("s.name")}, 'No status')`,
      value: count(),
    })
    .from(journalEntries)
    .leftJoin(sql`journal_statuses s`, sql`s.id = ${journalEntries.statusId}`)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        gte(journalEntries.reportDate, from),
        lte(journalEntries.reportDate, to),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}
