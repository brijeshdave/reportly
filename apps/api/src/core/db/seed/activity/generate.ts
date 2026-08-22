// Author: Brijesh Dave <https://github.com/brijeshdave>
// `cli seed:activity` — a plausible history over a date range, on top of whatever
// master data is already here.
//
// Separate from `seed:demo` because the two want opposite things: `seed:demo` invents
// its own people and assets and refuses to run when there is real data, while this one
// exists *for* real master data and writes nothing but transactions. Together they
// would need a flag that changed almost every line, which is two commands wearing one
// name.
//
// **Shape matters more than volume.** Rows scattered uniformly give flat charts and
// reports where every filter returns the same thing. So: weekdays carry most of the
// work, one week in the range is a bad week on one device, a few entries are left open
// at the end, and a task is completed without being logged — because each of those is
// a screen state somebody needs to see working.
//
// Every row it writes is marked (see `MARK`), so `--purge` can take back exactly what
// it wrote and nothing a person typed.
import { randomUUID } from "node:crypto";

import { and, eq, inArray, like, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  downtimeEntries,
  journalEntries,
  journalParticipants,
  journalScores,
  journalStatusEvents,
  journalTargets,
  pointAwards,
  routineCompletions,
  scheduleEntries,
  schedules,
  tasks,
} from "@/core/db/schema.js";
import {
  takeInventory,
  type CompanyInventory,
  type DepartmentInventory,
} from "@/core/db/seed/activity/inventory.js";
import {
  atHour,
  datesBetween,
  isWeekend,
  makeRng,
  type Rng,
} from "@/core/db/seed/activity/random.js";

/**
 * The marker that makes a generated row removable.
 *
 * It goes in a text column every domain already has, rather than a new column: a
 * schema change to support demo data would be the demo data deciding the shape of the
 * product. `--purge` matches on it, so anything a person wrote is never touched.
 */
export const MARK = "[demo]";

export type Volume = "light" | "normal" | "heavy";

const PER_PERSON_PER_WEEK: Record<Volume, { entries: number; downtime: number; tasks: number }> = {
  light: { entries: 1, downtime: 0.3, tasks: 0.5 },
  normal: { entries: 3, downtime: 1, tasks: 1.5 },
  heavy: { entries: 6, downtime: 2, tasks: 3 },
};

export interface GenerateOptions {
  from: Date;
  to: Date;
  volume: Volume;
  seed: number;
  companyIds?: string[];
}

export interface GenerateCounts {
  entries: number;
  downtime: number;
  tasks: number;
  scores: number;
  awards: number;
  routineCompletions: number;
  scheduleDays: number;
}

const TITLES_ISSUE = [
  "Line stopped mid-cycle",
  "Panel HMI froze",
  "Coolant pressure low",
  "Conveyor belt slipping",
  "Sensor reading out of range",
  "Motor overheating",
  "Air leak on the manifold",
  "Unexpected alarm on start-up",
];
const TITLES_WORK = [
  "Replaced the drive belt",
  "Cleaned and recalibrated the sensor",
  "Topped up coolant and checked for leaks",
  "Swapped the failed contactor",
  "Reseated the loose connector",
  "Greased the bearings",
  "Firmware updated on the controller",
];

/** Roughly `weekly` events across the range, weekday-biased, as dates. */
function spread(dates: string[], weeklyRate: number, people: number, rng: Rng): string[] {
  const weeks = Math.max(dates.length / 7, 1);
  const total = Math.round(weeklyRate * people * weeks);
  const out: string[] = [];
  for (let i = 0; i < total; i += 1) {
    // Two draws, keeping the weekday one: work happens on working days, and a
    // histogram with a weekend dip is the first sign the data is not uniform noise.
    const first = dates[rng.int(0, dates.length - 1)]!;
    const second = dates[rng.int(0, dates.length - 1)]!;
    out.push(isWeekend(first) && !isWeekend(second) ? second : first);
  }
  return out.sort();
}

async function generateDepartment(
  company: CompanyInventory,
  dept: DepartmentInventory,
  dates: string[],
  options: GenerateOptions,
  rng: Rng,
  counts: GenerateCounts,
): Promise<void> {
  if (dept.members.length === 0) return;

  const rates = PER_PERSON_PER_WEEK[options.volume];
  const memberIds = dept.members.map((m) => m.userId);
  const leads = dept.members.filter((m) => m.rank !== "member").map((m) => m.userId);

  // The bad week: one device, one week, a cluster of failures. Without it reliability
  // is a flat line and "recurring issues" counts nothing.
  const badWeekStart = rng.int(0, Math.max(dates.length - 7, 0));
  const badWeek = new Set(dates.slice(badWeekStart, badWeekStart + 7));
  const badDevice = rng.pick(dept.deviceIds);

  // --- journal entries, with their status trail, scores and points ---
  for (const date of spread(dates, rates.entries, memberIds.length, rng)) {
    const author = rng.pick(memberIds)!;
    const isIssue = rng.chance(0.55);
    const inBadWeek = badWeek.has(date) && badDevice !== undefined;
    // A few at the end stay open, so Reviews and "awaiting review" are not empty.
    const nearEnd = dates.indexOf(date) > dates.length - 5;
    const resolved = !nearEnd || rng.chance(0.4);

    const occurredAt = atHour(date, rng.int(6, 20), rng);
    const id = randomUUID();
    const title = `${isIssue ? rng.pick(TITLES_ISSUE) : rng.pick(TITLES_WORK)} ${MARK}`;

    await db.insert(journalEntries).values({
      id,
      companyId: company.id,
      authorId: author,
      kind: isIssue ? "issue" : "work",
      state: "submitted",
      title,
      categoryId: rng.pick(dept.categoryIds) ?? null,
      departmentId: dept.id,
      severityId: inBadWeek
        ? (company.severityIds[company.severityIds.length - 1] ?? null)
        : (rng.pick(company.severityIds) ?? null),
      statusId: resolved ? company.statuses.resolved : company.statuses.open,
      locationId: dept.locationId,
      reportDate: occurredAt,
      occurredAt,
      startedAt: occurredAt,
      endedAt: resolved ? new Date(occurredAt.getTime() + rng.int(20, 240) * 60_000) : null,
      issueSummary: isIssue ? "Found during the shift and confirmed under load." : null,
      workSummary: isIssue ? null : "Done and checked before handover.",
      submittedAt: occurredAt,
    });
    counts.entries += 1;

    await db.insert(journalParticipants).values({ reportId: id, userId: author, addedBy: author });

    // The creation event, then the move to resolved. The reports read this trail for
    // time-to-resolve, so an entry with no events is an entry no report can time.
    await db.insert(journalStatusEvents).values({
      reportId: id,
      fromStatusId: null,
      toStatusId: resolved ? company.statuses.open : company.statuses.open,
      changedBy: author,
      changedAt: occurredAt,
    });
    if (resolved && company.statuses.resolved) {
      await db.insert(journalStatusEvents).values({
        reportId: id,
        fromStatusId: company.statuses.open,
        toStatusId: company.statuses.resolved,
        changedBy: author,
        changedAt: new Date(occurredAt.getTime() + rng.int(30, 600) * 60_000),
      });
    }

    // What it was about: the bad week always names its device, so the recurring-issue
    // and reliability figures have something to group by.
    const targetId = inBadWeek ? badDevice : rng.pick(dept.deviceIds);
    if (targetId) {
      await db.insert(journalTargets).values({ reportId: id, targetKind: "device", targetId });
    }

    // Scores, and the points ledger the leaderboard sums. Self first, then the lead's
    // review — which is what makes the two-tier scoring visible.
    if (resolved) {
      const points = rng.int(2, 9);
      await db
        .insert(journalScores)
        .values({ reportId: id, subjectUserId: author, tier: "self", raterId: author, points });
      counts.scores += 1;

      const lead = leads.find((l) => l !== author);
      if (lead && rng.chance(0.7)) {
        await db.insert(journalScores).values({
          reportId: id,
          subjectUserId: author,
          tier: "review",
          raterId: lead,
          points: Math.max(1, points + rng.int(-2, 2)),
        });
        counts.scores += 1;
      }

      await db.insert(pointAwards).values({
        beneficiaryUserId: author,
        companyId: company.id,
        earnedOn: date,
        departmentId: dept.id,
        source: "report",
        reportId: id,
        kind: "direct",
        depth: 0,
        points,
      });
      counts.awards += 1;

      // The roll-up a manager earns from their downline, so the leaderboard is not a
      // straight line of identical people.
      const manager = dept.members.find((m) => m.userId === author)?.reportsToId;
      if (manager) {
        await db.insert(pointAwards).values({
          beneficiaryUserId: manager,
          companyId: company.id,
          earnedOn: date,
          departmentId: dept.id,
          source: "report",
          reportId: id,
          kind: "rollup",
          depth: 1,
          points: Math.round(points * 0.25 * 10) / 10,
        });
        counts.awards += 1;
      }
    }

    // Downtime, on the issues that stopped something.
    if (isIssue && targetId && rng.chance(0.35)) {
      const startedAt = occurredAt;
      await db.insert(downtimeEntries).values({
        companyId: company.id,
        reportId: id,
        targetKind: "device",
        targetId,
        reason: `${inBadWeek ? "Repeat failure" : "Unplanned stop"} ${MARK}`,
        startedAt,
        endedAt: resolved ? new Date(startedAt.getTime() + rng.int(15, 300) * 60_000) : null,
        createdBy: author,
      });
      counts.downtime += 1;
    }
  }

  // --- tasks: handed down the line, mostly done, one left unlogged on purpose ---
  for (const date of spread(dates, rates.tasks, memberIds.length, rng)) {
    const assigner = rng.pick(leads.length > 0 ? leads : memberIds)!;
    const assignee = rng.pick(memberIds.filter((m) => m !== assigner)) ?? assigner;
    const done = rng.chance(0.7);
    await db.insert(tasks).values({
      companyId: company.id,
      title: `${rng.pick(TITLES_WORK)} ${MARK}`,
      detail: "Raised from the morning walk-round.",
      assigneeId: assignee,
      assignerId: assigner,
      departmentId: dept.id,
      dueAt: atHour(date, 17, rng),
      priority: rng.pick(["low", "normal", "high"]) ?? "normal",
      state: done ? "done" : rng.chance(0.5) ? "in_progress" : "open",
      completedAt: done ? atHour(date, rng.int(9, 18), rng) : null,
    });
    counts.tasks += 1;
  }

  // --- routine completions: mostly done, some late, some missed ---
  for (const routine of dept.routines) {
    if (routine.assigneeIds.length === 0) continue;
    for (const date of dates) {
      if (isWeekend(date) || rng.chance(0.45)) continue;
      const userId = rng.pick(routine.assigneeIds)!;
      // A missed day is an absence of a row, which is what the compliance report
      // counts — so "missed" here simply means writing nothing.
      if (rng.chance(0.12)) continue;
      const startedAt = atHour(date, rng.int(7, 15), rng);
      await db.insert(routineCompletions).values({
        routineId: routine.id,
        occurrenceDate: date,
        userId,
        status: "completed",
        startedAt,
        finishedAt: new Date(startedAt.getTime() + rng.int(10, 90) * 60_000),
        notes: `Done ${MARK}`,
      });
      counts.routineCompletions += 1;
    }
  }

  // --- the rota, month by month across the range ---
  if (company.shiftIds.length > 0) {
    const months = new Set(dates.map((d) => d.slice(0, 7)));
    for (const month of months) {
      const [year, monthNumber] = month.split("-").map(Number);
      const existing = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(
          and(
            eq(schedules.departmentId, dept.id),
            eq(schedules.year, year!),
            eq(schedules.month, monthNumber!),
            dept.locationId
              ? eq(schedules.locationId, dept.locationId)
              : sql`${schedules.locationId} is null`,
          ),
        );
      if (existing.length > 0) continue; // never overwrite a rota somebody built

      const [schedule] = await db
        .insert(schedules)
        .values({
          companyId: company.id,
          departmentId: dept.id,
          locationId: dept.locationId,
          year: year!,
          month: monthNumber!,
          status: "published",
          publishedAt: new Date(`${month}-01T00:00:00.000Z`),
        })
        .returning({ id: schedules.id });

      const monthDates = dates.filter((d) => d.startsWith(month));
      for (const member of dept.members) {
        // Each person keeps one shift for a stretch, then rotates — a rota that
        // changed every day would be nobody's rota.
        let shift = rng.pick(company.shiftIds)!;
        let held = 0;
        for (const date of monthDates) {
          if (held >= rng.int(5, 8)) {
            shift = rng.pick(company.shiftIds)!;
            held = 0;
          }
          held += 1;
          const off = isWeekend(date) && rng.chance(0.8);
          const leave = !off && rng.chance(0.03);
          await db.insert(scheduleEntries).values({
            scheduleId: schedule!.id,
            date,
            userId: member.userId,
            shiftId: off || leave ? null : shift.id,
            state: off ? "off" : leave ? "leave" : "working",
            plannedShiftId: off || leave ? null : shift.id,
            plannedState: off ? "off" : leave ? "leave" : "working",
          });
          counts.scheduleDays += 1;
        }
      }
    }
  }
}

/** Generate a history. Returns what it wrote. */
export async function generateActivity(options: GenerateOptions): Promise<GenerateCounts> {
  const inventory = await takeInventory(options.companyIds);
  const dates = datesBetween(options.from, options.to);
  const rng = makeRng(options.seed);
  const counts: GenerateCounts = {
    entries: 0,
    downtime: 0,
    tasks: 0,
    scores: 0,
    awards: 0,
    routineCompletions: 0,
    scheduleDays: 0,
  };

  for (const company of inventory) {
    for (const dept of company.departments) {
      await generateDepartment(company, dept, dates, options, rng, counts);
    }
  }
  return counts;
}

/**
 * Remove what a previous run wrote, and nothing else.
 *
 * Matched on the marker rather than on a date range: a range would also catch the real
 * entries somebody filed while looking at the demo data, and losing one of those is
 * the whole reason this command has a purge at all.
 */
export async function purgeActivity(): Promise<{
  entries: number;
  tasks: number;
  downtime: number;
}> {
  const entryRows = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(like(journalEntries.title, `%${MARK}`));
  const entryIds = entryRows.map((r) => r.id);

  if (entryIds.length > 0) {
    // Points first: the award references the entry, and the entry's delete would
    // cascade, but an explicit delete is what makes the count honest.
    await db.delete(pointAwards).where(inArray(pointAwards.reportId, entryIds));
    await db.delete(journalEntries).where(inArray(journalEntries.id, entryIds));
  }

  const taskResult = await db
    .delete(tasks)
    .where(like(tasks.title, `%${MARK}`))
    .returning({
      id: tasks.id,
    });
  const downtimeResult = await db
    .delete(downtimeEntries)
    .where(like(downtimeEntries.reason, `%${MARK}`))
    .returning({ id: downtimeEntries.id });
  await db.delete(routineCompletions).where(like(routineCompletions.notes, `%${MARK}`));

  return {
    entries: entryIds.length,
    tasks: taskResult.length,
    downtime: downtimeResult.length,
  };
}
