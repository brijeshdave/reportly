// Author: Brijesh Dave <https://github.com/brijeshdave>
// The aggregations behind the management pack — the numbers somebody puts in front
// of their management once a month.
//
// Asked for from use: "i need a dashboard and reposrts that i can show to
// management for each month OR meeting in my presentation ppt… It should have many
// indicators and charts."
//
// Two rules run through this file:
//
//   1. **Every figure states its window.** Each function takes `from`/`to` and is
//      called twice — once for the period, once for the period before it — so the
//      movement on a card is the same query over two windows rather than a second,
//      subtly different definition of the same thing.
//   2. **Company-scoped without exception**, like `insights-repo` beside it, plus
//      optional site and department narrowing so a pack can be about one plant.
//      `companyId` is a required argument for the reason SF-006 exists.
import { and, count, desc, eq, gte, isNotNull, lte, sql, sum, type SQL } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  assets,
  departments,
  downtimeEntries,
  journalEntries,
  locations,
  parts,
  pointAwards,
  routineAssignees,
  routineCompletions,
  routines,
  serviceEvents,
  serviceKinds,
  taskAssignees,
  tasks,
  users,
} from "@/core/db/schema.js";

export interface Point {
  label: string;
  value: number;
}

/** How a pack is narrowed: one company, optionally one site and one department. */
export interface PackScope {
  companyId: string;
  locationId?: string | null;
  departmentId?: string | null;
}

/** The journal's own narrowing, shared by every entry-shaped query here. */
function journalScope(scope: PackScope, from: Date, to: Date): SQL | undefined {
  return and(
    eq(journalEntries.companyId, scope.companyId),
    gte(journalEntries.reportDate, from),
    lte(journalEntries.reportDate, to),
    scope.locationId ? eq(journalEntries.locationId, scope.locationId) : undefined,
    scope.departmentId ? eq(journalEntries.departmentId, scope.departmentId) : undefined,
  );
}

export interface JournalTotals {
  issues: number;
  work: number;
  resolved: number;
  /** Median hours from an issue being filed to reaching a resolved status. */
  medianResolutionHours: number | null;
  /** How many people filed anything at all — the pack's "is this being used". */
  contributors: number;
}

/**
 * The journal's headline counts for a window.
 *
 * Resolved is counted by the *status group*, not by a status name: the names are an
 * installation's own vocabulary ("Closed", "Fixed", "Sorted"), and a query that
 * listed them would be wrong on the next installation and silently wrong on this
 * one the day somebody renames one.
 *
 * The median, not the mean, for time-to-resolve. One issue left open over Christmas
 * drags a mean into uselessness, and the number people actually want is "how long
 * does a normal one take".
 */
export async function journalTotals(
  scope: PackScope,
  from: Date,
  to: Date,
): Promise<JournalTotals> {
  const where = journalScope(scope, from, to);

  const [counts] = await db
    .select({
      issues: sql<number>`count(*) filter (where ${journalEntries.kind} = 'issue')::int`,
      work: sql<number>`count(*) filter (where ${journalEntries.kind} <> 'issue')::int`,
      contributors: sql<number>`count(distinct ${journalEntries.authorId})::int`,
    })
    .from(journalEntries)
    .where(where);

  // When an entry *reached* a resolved status, which the entry itself does not
  // record — the status trail does. The first such event is the one that counts: an
  // entry reopened and resolved again took as long as it took the first time, and
  // reading the last event would silently reward closing something twice.
  const resolvedAt = sql`(
    SELECT min(e.changed_at) FROM journal_status_events e
    JOIN journal_statuses st ON st.id = e.to_status_id
    WHERE e.report_id = ${journalEntries.id} AND st."group" = 'resolved'
  )`;
  // Issues only, and that matters more than it looks: a **work log** starts at the
  // resolved end by design — it is a record of work already done — so counting
  // every kind here would report a month's planned work as "issues resolved" and
  // drag the median time-to-resolve towards zero, because a work log is resolved
  // the second it is filed. Seen on the exported slide before it was seen in a test.
  const [resolved] = await db
    .select({
      n: sql<number>`count(*) filter (where ${resolvedAt} is not null)::int`,
      // The median hours from filing to that first resolution. Entries never
      // resolved are excluded rather than counted as zero, which would be a claim
      // that an open issue took no time at all.
      median: sql<
        number | null
      >`percentile_cont(0.5) within group (order by extract(epoch from (${resolvedAt} - ${journalEntries.createdAt})) / 3600)`,
    })
    .from(journalEntries)
    .where(and(where, eq(journalEntries.kind, "issue")));

  return {
    issues: Number(counts?.issues ?? 0),
    work: Number(counts?.work ?? 0),
    resolved: Number(resolved?.n ?? 0),
    medianResolutionHours:
      resolved?.median === null || resolved?.median === undefined
        ? null
        : Math.round(Number(resolved.median) * 10) / 10,
    contributors: Number(counts?.contributors ?? 0),
  };
}

export interface DowntimeTotals {
  minutes: number;
  events: number;
  /** Mean minutes per stoppage — the "how bad is a typical one" figure. */
  meanMinutes: number | null;
}

/**
 * Downtime for a window. Closed spans only, for the reason `downtimeByAsset` gives:
 * an open span has no end, so counting it means choosing "now", and a figure that
 * grows while you look at it is not a measurement.
 */
export async function downtimeTotals(
  scope: PackScope,
  from: Date,
  to: Date,
): Promise<DowntimeTotals> {
  const minutes = sql<number>`coalesce(sum(extract(epoch from (${downtimeEntries.endedAt} - ${downtimeEntries.startedAt})) / 60), 0)`;
  const [row] = await db
    .select({ minutes, events: sql<number>`count(*)::int` })
    .from(downtimeEntries)
    .where(
      and(
        eq(downtimeEntries.companyId, scope.companyId),
        isNotNull(downtimeEntries.endedAt),
        gte(downtimeEntries.startedAt, from),
        lte(downtimeEntries.startedAt, to),
      ),
    );

  const total = Math.round(Number(row?.minutes ?? 0));
  const events = Number(row?.events ?? 0);
  return {
    minutes: total,
    events,
    meanMinutes: events === 0 ? null : Math.round((total / events) * 10) / 10,
  };
}

/** Downtime minutes per bucket, for the reliability trend. */
export async function downtimeOverTime(scope: PackScope, from: Date, to: Date): Promise<Point[]> {
  const rows = await db
    .select({
      label: sql<string>`to_char(date_trunc('day', ${downtimeEntries.startedAt}), 'YYYY-MM-DD')`,
      value: sql<number>`coalesce(sum(extract(epoch from (${downtimeEntries.endedAt} - ${downtimeEntries.startedAt})) / 60), 0)`,
    })
    .from(downtimeEntries)
    .where(
      and(
        eq(downtimeEntries.companyId, scope.companyId),
        isNotNull(downtimeEntries.endedAt),
        gte(downtimeEntries.startedAt, from),
        lte(downtimeEntries.startedAt, to),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ label: r.label, value: Math.round(Number(r.value)) }));
}

export interface TaskTotals {
  raised: number;
  completed: number;
  /** Still open, and past the date they were due — the number that embarrasses. */
  overdue: number;
}

export async function taskTotals(scope: PackScope, from: Date, to: Date): Promise<TaskTotals> {
  const base = and(
    eq(tasks.companyId, scope.companyId),
    scope.locationId ? eq(tasks.locationId, scope.locationId) : undefined,
    scope.departmentId ? eq(tasks.departmentId, scope.departmentId) : undefined,
  );

  const [raised] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(base, gte(tasks.createdAt, from), lte(tasks.createdAt, to)));

  const [completed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(base, eq(tasks.state, "done"), gte(tasks.completedAt, from), lte(tasks.completedAt, to)),
    );

  // Overdue is a fact about *now*, not about the window: a task that was overdue in
  // March and finished in April is not something to report in April's pack. It is
  // counted against the end of the window so a pack for a past month still says what
  // was outstanding when that month closed.
  const [overdue] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        base,
        sql`${tasks.state} not in ('done', 'cancelled')`,
        isNotNull(tasks.dueAt),
        lte(tasks.dueAt, to),
      ),
    );

  return {
    raised: Number(raised?.n ?? 0),
    completed: Number(completed?.n ?? 0),
    overdue: Number(overdue?.n ?? 0),
  };
}

/** Tasks completed per person in the window — who is clearing the work. */
export async function tasksCompletedByPerson(
  scope: PackScope,
  from: Date,
  to: Date,
  limit = 10,
): Promise<Point[]> {
  const rows = await db
    .select({ label: users.name, value: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(
      and(
        eq(tasks.companyId, scope.companyId),
        eq(tasks.state, "done"),
        gte(tasks.completedAt, from),
        lte(tasks.completedAt, to),
        scope.locationId ? eq(tasks.locationId, scope.locationId) : undefined,
        scope.departmentId ? eq(tasks.departmentId, scope.departmentId) : undefined,
      ),
    )
    .groupBy(users.name)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

export interface RoutineTotals {
  completed: number;
  /** Completions that were signed off after the routine's own due date. */
  late: number;
  /** Routines with an assignment live in the window — the denominator. */
  active: number;
}

export async function routineTotals(
  scope: PackScope,
  from: Date,
  to: Date,
): Promise<RoutineTotals> {
  const [done] = await db
    .select({
      n: sql<number>`count(*)::int`,
      // Late means signed off after the day it was for. The occurrence date is the
      // routine's own due day, so this needs no second source of truth.
      late: sql<number>`count(*) filter (where ${routineCompletions.finishedAt}::date > ${routineCompletions.occurrenceDate})::int`,
    })
    .from(routineCompletions)
    .innerJoin(routines, eq(routines.id, routineCompletions.routineId))
    .where(
      and(
        eq(routines.companyId, scope.companyId),
        eq(routineCompletions.status, "completed"),
        gte(routineCompletions.finishedAt, from),
        lte(routineCompletions.finishedAt, to),
        scope.departmentId ? eq(routines.departmentId, scope.departmentId) : undefined,
      ),
    );

  const [active] = await db
    .select({ n: sql<number>`count(distinct ${routines.id})::int` })
    .from(routines)
    .innerJoin(routineAssignees, eq(routineAssignees.routineId, routines.id))
    .where(
      and(
        eq(routines.companyId, scope.companyId),
        eq(routines.status, "active"),
        scope.departmentId ? eq(routines.departmentId, scope.departmentId) : undefined,
      ),
    );

  return {
    completed: Number(done?.n ?? 0),
    late: Number(done?.late ?? 0),
    active: Number(active?.n ?? 0),
  };
}

/** Routine completions per department — where the checks are actually being done. */
export async function routinesByDepartment(
  scope: PackScope,
  from: Date,
  to: Date,
): Promise<Point[]> {
  const rows = await db
    .select({ label: departments.name, value: sql<number>`count(*)::int` })
    .from(routineCompletions)
    .innerJoin(routines, eq(routines.id, routineCompletions.routineId))
    .innerJoin(departments, eq(departments.id, routines.departmentId))
    .where(
      and(
        eq(routines.companyId, scope.companyId),
        eq(routineCompletions.status, "completed"),
        gte(routineCompletions.finishedAt, from),
        lte(routineCompletions.finishedAt, to),
      ),
    )
    .groupBy(departments.name)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** Points awarded in the window — the total behind "points by person/department". */
export async function pointsTotal(scope: PackScope, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ total: sum(pointAwards.points) })
    .from(pointAwards)
    .where(
      and(
        eq(pointAwards.companyId, scope.companyId),
        eq(pointAwards.kind, "direct"),
        gte(pointAwards.earnedOn, from.toISOString().slice(0, 10)),
        lte(pointAwards.earnedOn, to.toISOString().slice(0, 10)),
        scope.departmentId ? eq(pointAwards.departmentId, scope.departmentId) : undefined,
      ),
    );
  return Math.round(Number(row?.total ?? 0) * 10) / 10;
}

/** Issues per department — which part of the plant is generating the work. */
export async function issuesByDepartment(scope: PackScope, from: Date, to: Date): Promise<Point[]> {
  const rows = await db
    .select({ label: departments.name, value: count() })
    .from(journalEntries)
    .innerJoin(departments, eq(departments.id, journalEntries.departmentId))
    .where(and(journalScope(scope, from, to), eq(journalEntries.kind, "issue")))
    .groupBy(departments.name)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** Issues per severity, worst first by the ladder's own order. */
export async function issuesBySeverity(scope: PackScope, from: Date, to: Date): Promise<Point[]> {
  const rows = await db
    .select({
      label: sql<string>`coalesce(sev.name, 'Not set')`,
      order: sql<number>`coalesce(sev.order_index, -1)`,
      value: count(),
    })
    .from(journalEntries)
    .leftJoin(sql`severities sev`, sql`sev.id = ${journalEntries.severityId}`)
    .where(and(journalScope(scope, from, to), eq(journalEntries.kind, "issue")))
    .groupBy(sql`1`, sql`2`)
    .orderBy(desc(sql`2`));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** Entries filed per person — who is writing things down at all. */
export async function entriesByPerson(
  scope: PackScope,
  from: Date,
  to: Date,
  limit = 10,
): Promise<Point[]> {
  const rows = await db
    .select({ label: users.name, value: count() })
    .from(journalEntries)
    .innerJoin(users, eq(users.id, journalEntries.authorId))
    .where(journalScope(scope, from, to))
    .groupBy(users.name)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/**
 * Entries from the window still waiting to be scored — the review debt.
 *
 * "Reviewed" is the existence of a review-tier score, which is how the journal
 * itself decides it. Asking a different question here would give a pack that
 * disagrees with the Reviews page, and the pack is the one management sees.
 */
export async function awaitingReview(scope: PackScope, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(
      and(
        journalScope(scope, from, to),
        eq(journalEntries.state, "submitted"),
        sql`NOT EXISTS (
          SELECT 1 FROM journal_scores s
          WHERE s.report_id = ${journalEntries.id} AND s.tier = 'review'
        )`,
      ),
    );
  return Number(row?.n ?? 0);
}

/** Cartridges fitted in the window, per site — only drawn where the module is on. */
export async function cartridgesFitted(scope: PackScope, from: Date, to: Date): Promise<Point[]> {
  const rows = await db
    .select({
      label: sql<string>`coalesce(loc.name, 'No site')`,
      value: sql<number>`count(*)::int`,
    })
    .from(sql`part_placements pp`)
    .innerJoin(parts, sql`${parts.id} = pp.part_id`)
    .leftJoin(sql`locations loc`, sql`loc.id = ${parts.locationId}`)
    .where(
      and(
        eq(parts.companyId, scope.companyId),
        sql`pp.installed_at >= ${from}`,
        sql`pp.installed_at <= ${to}`,
      ),
    )
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** Assets by downtime, worst first — the reliability section's lead chart. */
export async function downtimeByAssetScoped(
  scope: PackScope,
  from: Date,
  to: Date,
  limit = 10,
): Promise<Point[]> {
  const minutes = sql<number>`sum(extract(epoch from (${downtimeEntries.endedAt} - ${downtimeEntries.startedAt})) / 60)`;
  const rows = await db
    .select({ label: assets.name, value: minutes })
    .from(downtimeEntries)
    .innerJoin(
      assets,
      and(
        eq(assets.id, sql`${downtimeEntries.targetId}::uuid`),
        eq(assets.companyId, scope.companyId),
      ),
    )
    .where(
      and(
        eq(downtimeEntries.companyId, scope.companyId),
        eq(downtimeEntries.targetKind, "asset"),
        isNotNull(downtimeEntries.endedAt),
        gte(downtimeEntries.startedAt, from),
        lte(downtimeEntries.startedAt, to),
        scope.locationId ? eq(assets.locationId, scope.locationId) : undefined,
      ),
    )
    .groupBy(assets.name)
    .orderBy(desc(minutes))
    .limit(limit);
  return rows.map((r) => ({ label: r.label, value: Math.round(Number(r.value)) }));
}

/**
 * Issues per site.
 *
 * Asked for from use: "i need location wise data to be shown in presentation". A
 * company with four plants meets about four plants, and a single company-wide bar
 * answers none of the questions that meeting asks.
 */
export async function issuesByLocation(scope: PackScope, from: Date, to: Date): Promise<Point[]> {
  const rows = await db
    .select({
      label: sql<string>`coalesce(${locations.name}, 'No site')`,
      value: count(),
    })
    .from(journalEntries)
    .leftJoin(locations, eq(locations.id, journalEntries.locationId))
    .where(and(journalScope(scope, from, to), eq(journalEntries.kind, "issue")))
    .groupBy(sql`1`)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** Downtime minutes per site, taken from where the asset that stopped lives. */
export async function downtimeByLocation(scope: PackScope, from: Date, to: Date): Promise<Point[]> {
  const minutes = sql<number>`sum(extract(epoch from (${downtimeEntries.endedAt} - ${downtimeEntries.startedAt})) / 60)`;
  const rows = await db
    .select({ label: sql<string>`coalesce(${locations.name}, 'No site')`, value: minutes })
    .from(downtimeEntries)
    .innerJoin(
      assets,
      and(
        eq(assets.id, sql`${downtimeEntries.targetId}::uuid`),
        eq(assets.companyId, scope.companyId),
      ),
    )
    .leftJoin(locations, eq(locations.id, assets.locationId))
    .where(
      and(
        eq(downtimeEntries.companyId, scope.companyId),
        eq(downtimeEntries.targetKind, "asset"),
        isNotNull(downtimeEntries.endedAt),
        gte(downtimeEntries.startedAt, from),
        lte(downtimeEntries.startedAt, to),
        scope.locationId ? eq(assets.locationId, scope.locationId) : undefined,
      ),
    )
    .groupBy(sql`1`)
    .orderBy(desc(minutes));
  return rows.map((r) => ({ label: r.label, value: Math.round(Number(r.value)) }));
}

export interface SiteRow {
  site: string;
  issues: number;
  resolved: number;
  open: number;
  downtimeMinutes: number;
}

/**
 * One row per site: what was raised there, what was closed, what is still open, and
 * how long it was down.
 *
 * A table rather than a fifth chart, because this is the slide somebody reads across
 * — "which plant is the problem" is a comparison of four numbers per site, and four
 * bar charts side by side make the reader do the joining themselves.
 *
 * Sites with nothing at all are left out: an operations review is about where the
 * work was, and a row of zeroes for a site with no equipment is noise.
 */
export async function siteSummary(scope: PackScope, from: Date, to: Date): Promise<SiteRow[]> {
  const resolvedAt = sql`(
    SELECT min(e.changed_at) FROM journal_status_events e
    JOIN journal_statuses st ON st.id = e.to_status_id
    WHERE e.report_id = ${journalEntries.id} AND st."group" = 'resolved'
  )`;
  const entries = await db
    .select({
      site: sql<string>`coalesce(${locations.name}, 'No site')`,
      issues: sql<number>`count(*) filter (where ${journalEntries.kind} = 'issue')::int`,
      resolved: sql<number>`count(*) filter (where ${journalEntries.kind} = 'issue' and ${resolvedAt} is not null)::int`,
    })
    .from(journalEntries)
    .leftJoin(locations, eq(locations.id, journalEntries.locationId))
    .where(journalScope(scope, from, to))
    .groupBy(sql`1`);

  const downtime = await downtimeByLocation(scope, from, to);
  const byName = new Map(downtime.map((d) => [d.label, d.value]));

  return entries
    .map((row) => ({
      site: row.site,
      issues: Number(row.issues),
      resolved: Number(row.resolved),
      open: Number(row.issues) - Number(row.resolved),
      downtimeMinutes: byName.get(row.site) ?? 0,
    }))
    .filter((row) => row.issues > 0 || row.downtimeMinutes > 0)
    .sort((a, b) => b.issues - a.issues);
}

/**
 * Cartridge services by kind — refills, repairs, whatever this company calls them.
 *
 * Reported from use: "in current details cartidges install are shown which is not
 * that important. the important is how many cartridges refilled and repaired."
 *
 * Grouped by the **service kind's own name** rather than by a pair of hard-coded
 * words: the kinds are an installation's vocabulary, and a query looking for
 * "refill" would report nothing at the first site that calls it something else.
 */
export async function cartridgeServicesByKind(
  scope: PackScope,
  from: Date,
  to: Date,
): Promise<Point[]> {
  const rows = await db
    .select({ label: serviceKinds.name, value: sql<number>`count(*)::int` })
    .from(serviceEvents)
    .innerJoin(serviceKinds, eq(serviceKinds.id, serviceEvents.serviceKindId))
    .where(
      and(
        eq(serviceEvents.companyId, scope.companyId),
        gte(serviceEvents.performedAt, from),
        lte(serviceEvents.performedAt, to),
      ),
    )
    .groupBy(serviceKinds.name)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** Cartridge services per site — where the workshop time went. */
export async function cartridgeServicesByLocation(
  scope: PackScope,
  from: Date,
  to: Date,
): Promise<Point[]> {
  const rows = await db
    .select({
      label: sql<string>`coalesce(${locations.name}, 'No site')`,
      value: sql<number>`count(*)::int`,
    })
    .from(serviceEvents)
    .innerJoin(parts, eq(parts.id, serviceEvents.partId))
    .leftJoin(locations, eq(locations.id, parts.locationId))
    .where(
      and(
        eq(serviceEvents.companyId, scope.companyId),
        gte(serviceEvents.performedAt, from),
        lte(serviceEvents.performedAt, to),
        scope.locationId ? eq(parts.locationId, scope.locationId) : undefined,
      ),
    )
    .groupBy(sql`1`)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** How many cartridge services happened at all — the headline figure. */
export async function cartridgeServiceCount(
  scope: PackScope,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(serviceEvents)
    .where(
      and(
        eq(serviceEvents.companyId, scope.companyId),
        gte(serviceEvents.performedAt, from),
        lte(serviceEvents.performedAt, to),
      ),
    );
  return Number(row?.n ?? 0);
}
