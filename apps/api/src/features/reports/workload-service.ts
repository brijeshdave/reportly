// Author: Brijesh Dave <https://github.com/brijeshdave>
// The three department workload reports: what each person did, the same day by day,
// and who did little or nothing.
//
// Three views of one query, which is why they share a filter set, a sort and a
// scope — asked for that way ("please create same filters and sorting for all").
// Keeping them in one module is what stops the three drifting into three different
// answers to "how many issues did Sam file in September".
import {
  DEPT_IRREGULARITY_COLUMNS,
  DEPT_SILENCE_COLUMNS,
  formatDate,
  DEPT_WORKLOAD_COLUMNS,
  type AuthContext,
  type ReportDefinition,
  type ReportGroup,
  type ReportRow,
  type ReportTotals,
  ERROR_CODES,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { dailyCountsFor, workingDayFlags } from "@/features/reports/workload-daily-repo.js";
import {
  countsFor,
  emptyCounts,
  workingDaysFor,
  type WorkloadCounts,
} from "@/features/reports/workload-repo.js";
import {
  categoryBuckets,
  entriesByCategory,
  entriesBySeverity,
  severityBuckets,
  type Bucket,
} from "@/features/reports/workload-breakdown-repo.js";
import { groupLabelFor, peopleInScope } from "@/features/reports/workload-people.js";
import {
  SILENCE_KINDS,
  lastActivityFor,
  type SilenceKind,
} from "@/features/reports/silence-repo.js";

const EMPTY_TOTALS: ReportTotals = { count: 0, durationMinutes: 0, downtimeMinutes: 0, points: 0 };

export interface WorkloadSourceResult {
  groups: ReportGroup[];
  totals: ReportTotals;
  columns: readonly string[];
  /** Supplied by the matrix, whose columns are days rather than a fixed set. */
  columnLabels?: readonly string[];
  assetName: string | null;
}

/** The activity columns, summed. Points are deliberately not among them: counts and
 *  points are different units, and a total mixing them would mean nothing. */
const activityTotal = (c: WorkloadCounts): number =>
  c.issues +
  c.plannedWork +
  c.tasks +
  c.partsFitted +
  c.partsRemoved +
  c.partsServiced +
  c.routines;

/**
 * What was due and did not happen — reported beside the total, never inside it.
 *
 * `total` is work done. Adding a miss to it would make somebody look busier for
 * having failed to do something, which is the opposite of what these columns are
 * for. Kept out for the same reason points are.
 */
const missedColumns = (c: WorkloadCounts): Record<string, string> => ({
  tasksOverdue: String(c.tasksOverdue),
  routinesMissed: String(c.routinesMissed),
});

/**
 * The local day an instant falls on.
 *
 * `tzOffsetMinutes` is minutes east of UTC, the same convention the range builder
 * uses. Reading these boundaries in UTC instead is an off-by-one-day waiting to
 * happen: a window that begins at local midnight begins at 18:30 the previous day
 * in UTC, so a week came out with eight columns and the wrong one at each end. It
 * did not show up in any test, because a test runs at offset zero where the two
 * readings agree — it showed up on a screen.
 */
const dayOf = (d: Date, tzOffsetMinutes: number): string =>
  new Date(d.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);

/** The last day actually inside a `[from, to)` window. */
const lastDayOf = (to: Date, tzOffsetMinutes: number): string =>
  dayOf(new Date(to.getTime() - 1), tzOffsetMinutes);

function requireCompany(ctx: AuthContext): string {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return ctx.companyId;
}

/** Rows sorted the same way in all three reports: by group, then by name. */
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Everything the three reports need before they diverge: who is in scope, what each
 * of them did, and how many days they were rostered to do it in.
 */
async function gather(ctx: AuthContext, from: Date, to: Date, tzOffsetMinutes: number) {
  const companyId = requireCompany(ctx);
  const fromDay = dayOf(from, tzOffsetMinutes);
  const toDay = lastDayOf(to, tzOffsetMinutes);

  const people = await peopleInScope(ctx, companyId);
  const ids = people.map((p) => p.userId);
  const counts = await countsFor(ids, companyId, from, to, fromDay, toDay);
  const workingDays = await workingDaysFor(ids, fromDay, toDay);

  return { companyId, fromDay, toDay, people, ids, counts, workingDays };
}

/**
 * Group the people, and work out each group's rostered high.
 *
 * The denominator of "18 / 24" is the most any colleague **in the same group** was
 * rostered, which is what makes the number mean something: a person at 18 of a
 * possible 24 was available less than the person beside them. Comparing against the
 * calendar instead would have every part-timer looking idle.
 */
function grouped<T extends { person: { userId: string; name: string } }>(
  rows: T[],
  people: Map<string, ReturnType<typeof groupLabelFor> extends string ? string : never>,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = people.get(row.person.userId) ?? "";
    const list = out.get(key) ?? [];
    list.push(row);
    out.set(key, list);
  }
  return out;
}

/** "18 / 24", or "18" when the group has no rota at all to compare against. */
const workingDaysCell = (days: number, high: number): string =>
  high > 0 ? `${days} / ${high}` : String(days);

// --- 1. one row per person ---------------------------------------------------

export async function runDeptWorkload(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tzOffsetMinutes: number,
): Promise<WorkloadSourceResult> {
  const { people, counts, workingDays } = await gather(ctx, from, to, tzOffsetMinutes);

  const labels = new Map(people.map((p) => [p.userId, groupLabelFor(p, definition.grouping)]));
  const rows = people
    .map((person) => ({ person, counts: counts.get(person.userId) ?? emptyCounts(person.userId) }))
    .sort((a, b) => byName(a.person, b.person));

  const groups: ReportGroup[] = [];
  let rowCount = 0;
  let overallPoints = 0;

  for (const [label, members] of grouped(rows, labels)) {
    // The group's rostered high — the denominator every row in it is measured by.
    const high = Math.max(0, ...members.map((m) => workingDays.get(m.person.userId) ?? 0));
    const reportRows: ReportRow[] = members.map((m, i) => {
      // `count` is what the footer prints as "N entries", so it counts rows. The
      // activity sum belongs in the Total column, not in a row count.
      rowCount += 1;
      overallPoints += m.counts.points;
      const total = activityTotal(m.counts);
      return {
        id: `${label}:${i}`,
        reportId: null,
        cells: {
          person: m.person.name,
          workingDays: workingDaysCell(workingDays.get(m.person.userId) ?? 0, high),
          issues: String(m.counts.issues),
          plannedWork: String(m.counts.plannedWork),
          tasks: String(m.counts.tasks),
          partsFitted: String(m.counts.partsFitted),
          partsRemoved: String(m.counts.partsRemoved),
          partsServiced: String(m.counts.partsServiced),
          routines: String(m.counts.routines),
          ...missedColumns(m.counts),
          points: String(m.counts.points),
          total: String(total),
        },
      };
    });
    groups.push({
      key: label || null,
      label: label || "Everyone",
      rows: reportRows,
      totals: { ...EMPTY_TOTALS, count: reportRows.length },
    });
  }

  return {
    groups,
    totals: { ...EMPTY_TOTALS, count: rowCount, points: overallPoints },
    columns: DEPT_WORKLOAD_COLUMNS,
    assetName: null,
  };
}

// --- 2. one row per person per day -------------------------------------------

/** "Mon 01" — a weekday and a date, which is what somebody reads a timesheet by.
 *  Short because a month puts thirty-one of these across the page. */
function dayHeader(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${weekday} ${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Every day in the window, so a quiet Tuesday is a column of its own rather than a gap. */
function daysBetween(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${fromDay}T00:00:00.000Z`);
  const end = new Date(`${toDay}T00:00:00.000Z`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function runDeptWorkloadDaily(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tzOffsetMinutes: number,
): Promise<WorkloadSourceResult> {
  const companyId = requireCompany(ctx);
  const fromDay = dayOf(from, tzOffsetMinutes);
  const toDay = lastDayOf(to, tzOffsetMinutes);

  const people = await peopleInScope(ctx, companyId);
  const ids = people.map((p) => p.userId);
  const daily = await dailyCountsFor(ids, companyId, from, to, fromDay, toDay, tzOffsetMinutes);
  const rostered = await workingDayFlags(ids, fromDay, toDay);
  const workingDays = await workingDaysFor(ids, fromDay, toDay);

  const byPersonDay = new Map(daily.map((d) => [`${d.userId} ${d.day}`, d]));
  const days = daysBetween(fromDay, toDay);

  // One column per day, one row per person. Asked for exactly that way: "for a week
  // in column and employee in row with only single row for each" — a timesheet, not
  // a list of days. The columns are the period, so a week gives seven and a month
  // gives thirty-one; the range picker decides, and nothing here has to know which.
  const columns = ["person", "workingDays", ...days, "total"];
  const columnLabels = ["Person", "Working days", ...days.map(dayHeader), "Total"];

  const labels = new Map(people.map((p) => [p.userId, groupLabelFor(p, definition.grouping)]));
  const rows = people.map((person) => ({ person })).sort((a, b) => byName(a.person, b.person));

  const groups: ReportGroup[] = [];
  let rowCount = 0;

  for (const [label, members] of grouped(rows, labels)) {
    const high = Math.max(0, ...members.map((m) => workingDays.get(m.person.userId) ?? 0));
    const reportRows: ReportRow[] = members.map((m) => {
      const cells: Record<string, string> = {
        person: m.person.name,
        workingDays: workingDaysCell(workingDays.get(m.person.userId) ?? 0, high),
      };
      let total = 0;
      for (const day of days) {
        const key = `${m.person.userId} ${day}`;
        const tally = byPersonDay.get(key);
        const did = tally ? activityTotal(tally) : 0;
        total += did;
        // A day off and a day at work with nothing done are not the same thing, and
        // the grid says which: a dash for a day they were not rostered, a number
        // for one they were. Work logged on a day off still shows its number —
        // that happened, and hiding it behind a dash would be the bigger lie.
        cells[day] = did === 0 && !rostered.has(key) ? "—" : String(did);
      }
      cells.total = String(total);
      rowCount += 1;
      return { id: m.person.userId, reportId: null, cells };
    });
    groups.push({
      key: label || null,
      label: label || "Everyone",
      rows: reportRows,
      totals: { ...EMPTY_TOTALS, count: reportRows.length },
    });
  }

  return {
    groups,
    totals: { ...EMPTY_TOTALS, count: rowCount },
    columns,
    columnLabels,
    assetName: null,
  };
}

// --- 3. one row per person, one column per severity or category ---------------

/**
 * Column headers that tell two same-named categories apart.
 *
 * Two departments may each have an "Electrical" category, and two columns with the
 * same heading is a table nobody can read. Only the ambiguous ones are qualified —
 * putting the department on every column would make the common case wordier to
 * solve a problem it does not have.
 */
function bucketLabels(buckets: Bucket[]): string[] {
  const seen = new Map<string, number>();
  for (const b of buckets) seen.set(b.name, (seen.get(b.name) ?? 0) + 1);
  return buckets.map((b) =>
    (seen.get(b.name) ?? 0) > 1 && b.departmentName ? `${b.name} (${b.departmentName})` : b.name,
  );
}

/**
 * A person per row, a severity or a category per column.
 *
 * The flat workload report says how much somebody did; this says what it was. Ten
 * Critical breakdowns and ten Informational ones are the same number and a different
 * month, and the same is true of ten electrical jobs against ten paperwork ones.
 *
 * `none` is a real column, not a gap: entries filed without a severity or a category
 * are exactly what an administrator is looking for when they read this, and folding
 * them into nothing would hide the thing worth fixing.
 */
async function runBreakdown(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tzOffsetMinutes: number,
  kind: "severity" | "category",
): Promise<WorkloadSourceResult> {
  const companyId = requireCompany(ctx);
  const fromDay = dayOf(from, tzOffsetMinutes);
  const toDay = lastDayOf(to, tzOffsetMinutes);

  const people = await peopleInScope(ctx, companyId);
  const ids = people.map((p) => p.userId);
  const [buckets, tallies, workingDays] = await Promise.all([
    kind === "severity" ? severityBuckets() : categoryBuckets(companyId),
    kind === "severity"
      ? entriesBySeverity(ids, companyId, from, to)
      : entriesByCategory(ids, companyId, from, to),
    workingDaysFor(ids, fromDay, toDay),
  ]);

  const counts = new Map<string, number>();
  const add = (userId: string, bucket: string, n: number) => {
    const key = `${userId} ${bucket}`;
    counts.set(key, (counts.get(key) ?? 0) + n);
  };
  for (const row of tallies) {
    // On the severity report a **work log** goes in its own column rather than into
    // "not set". It has no severity by design — completing a task opens one, and
    // "nothing broke here" has nothing to rate — so filing it beside issues that are
    // genuinely missing a severity would hide the only rows worth acting on.
    const isPlannedWork = kind === "severity" && "kind" in row && row.kind === "work";
    add(row.userId, isPlannedWork ? "work" : (row.bucketId ?? "none"), row.n);
  }

  // "Not set" earns its place only when something is in it. Since a submitted issue
  // must name a severity, it can now only hold entries filed before that rule — which
  // is exactly what an administrator wants to find, and a column of zeros forever
  // afterwards is noise.
  const anyUnset = [...counts].some(([key, n]) => key.endsWith(" none") && n > 0);
  const keys = [
    ...buckets.map((b) => b.id),
    ...(kind === "severity" ? ["work"] : []),
    ...(anyUnset ? ["none"] : []),
  ];
  const columns = ["person", "workingDays", ...keys, "total"];
  const columnLabels = [
    "Person",
    "Working days",
    ...bucketLabels(buckets),
    ...(kind === "severity" ? ["Planned work"] : []),
    ...(anyUnset ? ["Not set"] : []),
    "Total",
  ];

  const labels = new Map(people.map((p) => [p.userId, groupLabelFor(p, definition.grouping)]));
  const rows = people.map((person) => ({ person })).sort((a, b) => byName(a.person, b.person));

  const groups: ReportGroup[] = [];
  let rowCount = 0;

  for (const [label, members] of grouped(rows, labels)) {
    const high = Math.max(0, ...members.map((m) => workingDays.get(m.person.userId) ?? 0));
    const reportRows: ReportRow[] = members.map((m) => {
      const cells: Record<string, string> = {
        person: m.person.name,
        workingDays: workingDaysCell(workingDays.get(m.person.userId) ?? 0, high),
      };
      let total = 0;
      for (const key of keys) {
        const n = counts.get(`${m.person.userId} ${key}`) ?? 0;
        total += n;
        // A zero is written out rather than dashed. Unlike the daily grid there is no
        // "they were not here" to distinguish it from: nobody filed a Critical this
        // month is a fact about the work, and a dash would read as missing data.
        cells[key] = String(n);
      }
      cells.total = String(total);
      rowCount += 1;
      return { id: m.person.userId, reportId: null, cells };
    });
    groups.push({
      key: label || null,
      label: label || "Everyone",
      rows: reportRows,
      totals: { ...EMPTY_TOTALS, count: reportRows.length },
    });
  }

  return {
    groups,
    totals: { ...EMPTY_TOTALS, count: rowCount },
    columns,
    columnLabels,
    assetName: null,
  };
}

export const runDeptWorkloadSeverity = (
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tz: number,
) => runBreakdown(ctx, definition, from, to, tz, "severity");

export const runDeptWorkloadCategory = (
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tz: number,
) => runBreakdown(ctx, definition, from, to, tz, "category");

// --- 4. who has gone quiet ----------------------------------------------------

/** Seven days: a working week with nothing in it is the first thing worth a look. */
export const DEFAULT_SILENT_DAYS = 7;

/** Whole days between a moment and now, never negative. */
function daysSince(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86_400_000));
}

/**
 * Who has logged nothing, and for how long.
 *
 * Asked for from use: "a report that can show if any user is not logging anything
 * since last N number of days based on filters applied. i.e. like no journal, no
 * tasks, no refill or service or no routines. need for each of these."
 *
 * Not the irregularity report wearing a different hat. That asks "did less than N in
 * a window" — a question about volume, answered per window. This asks "has done
 * nothing at all since when", which the window cannot answer: somebody who filed
 * forty entries on the 1st and nothing since scores well on volume and is exactly
 * who this is for.
 *
 * `silenceKinds` is what makes it "for each of these": watching only routines finds
 * the person who files entries and skips their rounds, who is invisible to a report
 * that counts any activity at all.
 */
export async function runDeptSilence(
  ctx: AuthContext,
  definition: ReportDefinition,
  _from: Date,
  _to: Date,
  _tzOffsetMinutes: number,
  now = new Date(),
): Promise<WorkloadSourceResult> {
  const companyId = requireCompany(ctx);
  const threshold = definition.silentForDays ?? DEFAULT_SILENT_DAYS;
  const watched: readonly SilenceKind[] =
    definition.silenceKinds && definition.silenceKinds.length > 0
      ? definition.silenceKinds
      : SILENCE_KINDS;

  const people = await peopleInScope(ctx, companyId);
  const last = await lastActivityFor(
    people.map((p) => p.userId),
    companyId,
  );

  const labels = new Map(people.map((p) => [p.userId, groupLabelFor(p, definition.grouping)]));
  const rows = people.map((person) => ({ person })).sort((a, b) => byName(a.person, b.person));

  const groups: ReportGroup[] = [];
  let listed = 0;

  for (const [label, members] of grouped(rows, labels)) {
    const reportRows: ReportRow[] = [];

    for (const m of members) {
      const seen = last.get(m.person.userId) ?? {};
      // The most recent thing they did **of a watched kind**. Never done one at all
      // is the loudest answer of the lot, and it is not the same as a long gap.
      const newest = watched
        .map((kind) => seen[kind])
        .filter((at): at is Date => at !== undefined)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const quiet = newest ? daysSince(newest, now) : null;
      if (quiet !== null && quiet < threshold) continue;

      const cell = (at: Date | undefined) => (at ? formatDate(at.toISOString()) : "never");
      listed += 1;
      reportRows.push({
        id: m.person.userId,
        reportId: null,
        cells: {
          person: m.person.name,
          lastJournal: cell(seen.journal),
          lastTask: cell(seen.tasks),
          lastRoutine: cell(seen.routines),
          lastPart: cell(seen.parts),
          quietest: newest ? formatDate(newest.toISOString()) : "never",
          silentDays: quiet === null ? "never" : String(quiet),
        },
      });
    }

    // Longest silence first, and never-at-all above all of it: the top of this
    // report is the point of reading it.
    reportRows.sort((a, b) => {
      const av = a.cells.silentDays === "never" ? Infinity : Number(a.cells.silentDays);
      const bv = b.cells.silentDays === "never" ? Infinity : Number(b.cells.silentDays);
      return bv - av;
    });
    if (reportRows.length === 0) continue;
    groups.push({
      key: label || null,
      label: label || "Everyone",
      rows: reportRows,
      totals: { ...EMPTY_TOTALS, count: reportRows.length },
    });
  }

  return {
    groups,
    totals: { ...EMPTY_TOTALS, count: listed },
    columns: DEPT_SILENCE_COLUMNS,
    assetName: null,
  };
}

// --- 5. who did little or nothing --------------------------------------------

/** Below this much activity, a person is listed. One by default, so the report opens
 *  on "did nothing at all" and is tightened by hand from there. */
export const DEFAULT_IRREGULARITY_THRESHOLD = 1;

export async function runDeptIrregularity(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
  tzOffsetMinutes: number,
): Promise<WorkloadSourceResult> {
  const { people, counts, workingDays } = await gather(ctx, from, to, tzOffsetMinutes);
  const threshold = definition.irregularityThreshold ?? DEFAULT_IRREGULARITY_THRESHOLD;

  const labels = new Map(people.map((p) => [p.userId, groupLabelFor(p, definition.grouping)]));
  const rows = people
    .map((person) => ({ person, counts: counts.get(person.userId) ?? emptyCounts(person.userId) }))
    .sort((a, b) => byName(a.person, b.person));

  const groups: ReportGroup[] = [];
  let listed = 0;

  for (const [label, members] of grouped(rows, labels)) {
    // The group's average work per rostered day — the bar every row is measured
    // against, and shown on the row rather than left implied.
    let groupWork = 0;
    let groupDays = 0;
    for (const m of members) {
      groupWork += activityTotal(m.counts);
      groupDays += workingDays.get(m.person.userId) ?? 0;
    }
    const groupAverage = groupDays > 0 ? groupWork / groupDays : 0;
    const high = Math.max(0, ...members.map((m) => workingDays.get(m.person.userId) ?? 0));

    const reportRows: ReportRow[] = [];
    for (const m of members) {
      const total = activityTotal(m.counts);
      if (total >= threshold) continue;
      const days = workingDays.get(m.person.userId) ?? 0;
      // Dividing by no rostered days is not a performance figure, so it is not
      // reported as one. Somebody on no rota at all is its own kind of irregular,
      // and the dash says so rather than a 0.00 that reads like a measurement.
      const perDay = days > 0 ? total / days : null;
      listed += 1;
      reportRows.push({
        id: m.person.userId,
        reportId: null,
        cells: {
          person: m.person.name,
          workingDays: workingDaysCell(days, high),
          total: String(total),
          perDay: perDay === null ? "—" : perDay.toFixed(2),
          groupAverage: groupAverage.toFixed(2),
          below:
            perDay === null
              ? "no rota"
              : perDay < groupAverage
                ? `${Math.round((1 - perDay / (groupAverage || 1)) * 100)}%`
                : "—",
        },
      });
    }
    // Somebody with no rota sorts to the top: it is the loudest thing on the page.
    reportRows.sort((a, b) => {
      const aNo = a.cells.perDay === "—" ? 0 : 1;
      const bNo = b.cells.perDay === "—" ? 0 : 1;
      if (aNo !== bNo) return aNo - bNo;
      return Number(a.cells.total) - Number(b.cells.total);
    });
    if (reportRows.length === 0) continue;
    groups.push({
      key: label || null,
      label: label || "Everyone",
      rows: reportRows,
      totals: { ...EMPTY_TOTALS, count: reportRows.length },
    });
  }

  return {
    groups,
    totals: { ...EMPTY_TOTALS, count: listed },
    columns: DEPT_IRREGULARITY_COLUMNS,
    assetName: null,
  };
}
