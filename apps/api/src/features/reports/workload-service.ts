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
  DEPT_WORKLOAD_COLUMNS,
  DEPT_WORKLOAD_DAILY_COLUMNS,
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
import { groupLabelFor, peopleInScope } from "@/features/reports/workload-people.js";

const EMPTY_TOTALS: ReportTotals = { count: 0, durationMinutes: 0, downtimeMinutes: 0, points: 0 };

export interface WorkloadSourceResult {
  groups: ReportGroup[];
  totals: ReportTotals;
  columns: readonly string[];
  assetName: string | null;
}

/** The activity columns, summed. Points are deliberately not among them: counts and
 *  points are different units, and a total mixing them would mean nothing. */
const activityTotal = (c: WorkloadCounts): number =>
  c.issues + c.plannedWork + c.tasks + c.cartridges + c.routines;

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** The last day actually inside a `[from, to)` window. */
const lastDayOf = (to: Date): string => dayOf(new Date(to.getTime() - 1));

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
async function gather(ctx: AuthContext, from: Date, to: Date) {
  const companyId = requireCompany(ctx);
  const fromDay = dayOf(from);
  const toDay = lastDayOf(to);

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
): Promise<WorkloadSourceResult> {
  const { people, counts, workingDays } = await gather(ctx, from, to);

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
          cartridges: String(m.counts.cartridges),
          routines: String(m.counts.routines),
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

/** Every day in the window, so a quiet Tuesday is a row of zeros rather than a gap. */
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
  const fromDay = dayOf(from);
  const toDay = lastDayOf(to);

  const people = await peopleInScope(ctx, companyId);
  const ids = people.map((p) => p.userId);
  const daily = await dailyCountsFor(ids, companyId, from, to, fromDay, toDay, tzOffsetMinutes);
  const rostered = await workingDayFlags(ids, fromDay, toDay);

  const byPersonDay = new Map(daily.map((d) => [`${d.userId} ${d.day}`, d]));
  const days = daysBetween(fromDay, toDay);
  const nameOf = new Map(people.map((p) => [p.userId, p.name]));

  // One group per person by default — a month for one person reads down the page,
  // which is what "for each day for each user" asks for. Any other grouping falls
  // back to the shared labels so the three reports still group alike.
  const groups: ReportGroup[] = [];
  let dayRows = 0;
  let overallPoints = 0;

  for (const person of [...people].sort(byName)) {
    const reportRows: ReportRow[] = [];
    for (const day of days) {
      const key = `${person.userId} ${day}`;
      const counts = byPersonDay.get(key);
      const worked = rostered.has(key);
      // A day somebody was off is not a day they did nothing, and the report says
      // which: an empty row on a rostered day is the one worth asking about.
      if (!counts && !worked) continue;
      const tally = counts ?? emptyCounts(person.userId, day);
      const total = activityTotal(tally);
      dayRows += 1;
      overallPoints += tally.points;
      reportRows.push({
        id: key,
        reportId: null,
        cells: {
          date: day,
          person: person.name,
          issues: String(tally.issues),
          plannedWork: String(tally.plannedWork),
          tasks: String(tally.tasks),
          cartridges: String(tally.cartridges),
          routines: String(tally.routines),
          points: String(tally.points),
          total: String(total),
        },
      });
    }
    if (reportRows.length === 0) continue;
    const label =
      definition.grouping === "none" || definition.grouping === "date"
        ? (nameOf.get(person.userId) ?? person.name)
        : groupLabelFor(person, definition.grouping);
    const existing = groups.find((g) => g.label === label);
    if (existing) existing.rows.push(...reportRows);
    else {
      groups.push({
        key: label,
        label,
        rows: reportRows,
        totals: { ...EMPTY_TOTALS, count: reportRows.length },
      });
    }
  }

  for (const group of groups) group.totals = { ...EMPTY_TOTALS, count: group.rows.length };

  return {
    groups,
    totals: { ...EMPTY_TOTALS, count: dayRows, points: overallPoints },
    columns: DEPT_WORKLOAD_DAILY_COLUMNS,
    assetName: null,
  };
}

// --- 3. who did little or nothing --------------------------------------------

/** Below this much activity, a person is listed. One by default, so the report opens
 *  on "did nothing at all" and is tightened by hand from there. */
export const DEFAULT_IRREGULARITY_THRESHOLD = 1;

export async function runDeptIrregularity(
  ctx: AuthContext,
  definition: ReportDefinition,
  from: Date,
  to: Date,
): Promise<WorkloadSourceResult> {
  const { people, counts, workingDays } = await gather(ctx, from, to);
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
