// Author: Brijesh Dave <https://github.com/brijeshdave>
// The management pack: one month of the plant, assembled as headline numbers and
// sections of charts, ready to be printed or turned into slides.
//
// Asked for from use: "i need a dashboard and reposrts that i can show to management
// for each month OR meeting in my presentation ppt… It should have many indicators
// and charts… All should be printable and exportable for my ppt."
//
// The whole pack is one response. Fourteen round trips would make the page assemble
// itself on screen in front of whoever is presenting it, and — worse — let the
// sections disagree: a card computed at 10:00:01 beside a chart computed at 10:00:04
// is two different months if somebody files an entry in between.
//
// Every indicator is the **same query over two windows**. The movement on a card is
// therefore the period's own definition applied to the period before it, not a
// second, nearly-identical query that drifts the first time one of them changes.
import {
  type ManagementPack,
  type PackIndicator,
  type PackSection,
  type PackSectionData,
  PACK_SECTIONS,
  ERROR_CODES,
  type AnalyticsWindow,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { getCompanyById } from "@/features/companies/repo.js";
import * as pack from "@/features/analytics/pack-repo.js";
import * as insights from "@/features/analytics/insights-repo.js";
import { recurringIssues } from "@/features/analytics/repo.js";

const HOUR_MS = 3_600_000;

/** A window and the one before it, of the same length. */
export interface PackWindows {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  label: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Work out which month — or which range — the pack covers, and what it is compared
 * against.
 *
 * A month is the unit management meets in, so `month=YYYY-MM` is the first-class
 * input and the comparison is the month before it, not "thirty days earlier": a
 * pack for February against 30 days of January would compare 28 days with 31 and
 * call the difference a trend.
 *
 * With no month and no range, the pack opens on the **last complete month**. The
 * month in progress is the one number nobody can act on yet, and a half month
 * against a full one is the commonest way a dashboard lies.
 */
export function resolvePackWindows(query: {
  month?: string;
  from?: string;
  to?: string;
}): PackWindows {
  if (query.from && query.to) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Invalid pack window");
    }
    if (from >= to) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "`from` must be before `to`");
    }
    const span = to.getTime() - from.getTime();
    return {
      from,
      to,
      previousFrom: new Date(from.getTime() - span),
      previousTo: new Date(from.getTime() - 1),
      label: `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`,
    };
  }

  const now = new Date();
  let year: number;
  let month: number; // 0-based
  if (query.month) {
    const [y, m] = query.month.split("-").map(Number);
    year = y!;
    month = m! - 1;
    if (month < 0 || month > 11) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Invalid month");
    }
  } else {
    // The last complete month, in UTC like every other date in this codebase.
    year = now.getUTCFullYear();
    month = now.getUTCMonth() - 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }

  const from = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0) - 1);
  const previousFrom = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const previousTo = new Date(from.getTime() - 1);
  return {
    from,
    to,
    previousFrom,
    previousTo,
    label: `${MONTHS[month]} ${year}`,
  };
}

const windowOf = (from: Date, to: Date): AnalyticsWindow => ({
  from: from.toISOString(),
  to: to.toISOString(),
  hours: (to.getTime() - from.getTime()) / HOUR_MS,
});

/**
 * One card.
 *
 * `changePct` is null when the previous period was zero rather than infinity or a
 * flat 100%: "two issues, up from none" is a fact about a small number, and a
 * percentage would dress it as a trend. The card shows the two figures instead.
 */
function indicator(
  key: string,
  label: string,
  value: number | null,
  previous: number | null,
  options: { unit?: string; higherIsBetter?: boolean; hint: string },
): PackIndicator {
  const changePct =
    value === null || previous === null || previous === 0
      ? null
      : Math.round(((value - previous) / previous) * 1000) / 10;
  return {
    key,
    label,
    value,
    unit: options.unit ?? "",
    previous,
    changePct,
    higherIsBetter: options.higherIsBetter ?? true,
    hint: options.hint,
  };
}

/** Minutes as hours to one decimal — management reads hours, the data stores minutes. */
const asHours = (minutes: number): number => Math.round((minutes / 60) * 10) / 10;

/**
 * A share, or null when there is nothing to take a share of.
 *
 * Zero issues raised does not mean a 0% resolution rate — it means the question
 * does not arise, and a card reading "0%" against an empty month is a criticism of
 * a team that had a quiet month.
 */
const percent = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

/** Which sections were asked for; every one when the caller did not narrow it. */
function wantedSections(raw: string | undefined): PackSection[] {
  if (!raw) return [...PACK_SECTIONS];
  const asked = new Set(raw.split(",").map((s) => s.trim()));
  const known = PACK_SECTIONS.filter((section: PackSection) => asked.has(section));
  // An unknown name is ignored rather than refused: a saved link from an older
  // version naming a section that has since been renamed should still open a pack.
  return known.length > 0 ? known : [...PACK_SECTIONS];
}

export interface PackQuery {
  month?: string;
  from?: string;
  to?: string;
  locationId?: string;
  departmentId?: string;
  sections?: string;
}

/**
 * Build the pack.
 *
 * Sections the caller switched off are not queried at all. Hiding a section is then
 * also how somebody makes a slow pack fast on a big installation, rather than a way
 * of drawing less after paying for all of it.
 */
export async function managementPack(query: PackQuery, companyId: string): Promise<ManagementPack> {
  const windows = resolvePackWindows(query);
  const sections = wantedSections(query.sections);
  const scope: pack.PackScope = {
    companyId,
    locationId: query.locationId ?? null,
    departmentId: query.departmentId ?? null,
  };

  const { from, to, previousFrom, previousTo } = windows;
  const company = await getCompanyById(companyId);

  // The headline figures, and the same figures for the month before. Everything a
  // card needs comes from these six reads.
  const [journalNow, journalWas, downNow, downWas, tasksNow, tasksWas] = await Promise.all([
    pack.journalTotals(scope, from, to),
    pack.journalTotals(scope, previousFrom, previousTo),
    pack.downtimeTotals(scope, from, to),
    pack.downtimeTotals(scope, previousFrom, previousTo),
    pack.taskTotals(scope, from, to),
    pack.taskTotals(scope, previousFrom, previousTo),
  ]);
  const [routinesNow, routinesWas, pointsNow, pointsWas, waiting] = await Promise.all([
    pack.routineTotals(scope, from, to),
    pack.routineTotals(scope, previousFrom, previousTo),
    pack.pointsTotal(scope, from, to),
    pack.pointsTotal(scope, previousFrom, previousTo),
    pack.awaitingReview(scope, from, to),
  ]);

  const indicators: PackIndicator[] = [
    indicator("issues", "Issues raised", journalNow.issues, journalWas.issues, {
      higherIsBetter: false,
      hint: "Breakdowns and faults filed in the period.",
    }),
    indicator("resolved", "Issues resolved", journalNow.resolved, journalWas.resolved, {
      hint: "Entries that reached a resolved status.",
    }),
    indicator(
      "resolutionRate",
      "Resolution rate",
      percent(journalNow.resolved, journalNow.issues),
      percent(journalWas.resolved, journalWas.issues),
      { unit: "%", hint: "Resolved as a share of issues raised in the period." },
    ),
    indicator(
      "timeToResolve",
      "Median time to resolve",
      journalNow.medianResolutionHours,
      journalWas.medianResolutionHours,
      {
        unit: "h",
        higherIsBetter: false,
        hint: "Half of the resolved issues were closed faster than this.",
      },
    ),
    indicator("downtime", "Downtime", asHours(downNow.minutes), asHours(downWas.minutes), {
      unit: "h",
      higherIsBetter: false,
      hint: "Total of every closed stoppage that started in the period.",
    }),
    indicator("stoppages", "Stoppages", downNow.events, downWas.events, {
      higherIsBetter: false,
      hint: "Closed downtime spans in the period.",
    }),
    indicator("meanStoppage", "Average stoppage", downNow.meanMinutes, downWas.meanMinutes, {
      unit: "min",
      higherIsBetter: false,
      hint: "Downtime divided by the number of stoppages.",
    }),
    indicator("work", "Work logged", journalNow.work, journalWas.work, {
      hint: "Planned work and task write-ups filed in the period.",
    }),
    indicator("contributors", "People filing", journalNow.contributors, journalWas.contributors, {
      hint: "People who filed at least one entry.",
    }),
    indicator("tasksDone", "Tasks completed", tasksNow.completed, tasksWas.completed, {
      hint: "Tasks marked done in the period.",
    }),
    indicator("tasksOverdue", "Tasks overdue", tasksNow.overdue, tasksWas.overdue, {
      higherIsBetter: false,
      hint: "Still open and past their due date at the end of the period.",
    }),
    indicator(
      "routineCompliance",
      "Routines on time",
      percent(routinesNow.completed - routinesNow.late, routinesNow.completed),
      percent(routinesWas.completed - routinesWas.late, routinesWas.completed),
      { unit: "%", hint: "Completions signed off on or before the day they were due." },
    ),
    indicator("points", "Points awarded", pointsNow, pointsWas, {
      unit: "pts",
      hint: "Confirmed points earned for work in the period.",
    }),
    indicator("awaitingReview", "Awaiting review", waiting, null, {
      higherIsBetter: false,
      hint: "Submitted entries from the period that nobody has scored yet.",
    }),
  ];

  const built: PackSectionData[] = [];

  if (sections.includes("reliability")) {
    const [byAsset, downTrend, recurring] = await Promise.all([
      pack.downtimeByAssetScoped(scope, from, to),
      pack.downtimeOverTime(scope, from, to),
      recurringIssues(companyId, from, to),
    ]);
    built.push({
      section: "reliability",
      title: "Reliability and downtime",
      series: [
        {
          key: "downtimeByAsset",
          title: "Downtime by asset",
          description: "Where the hours went. Closed stoppages only.",
          unit: "min",
          points: byAsset,
        },
        {
          key: "downtimeOverTime",
          title: "Downtime through the period",
          description: "Minutes lost per day.",
          unit: "min",
          points: downTrend,
        },
      ],
      table: {
        title: "Issues that keep coming back",
        columns: ["Asset or device", "Kind of issue", "Times", "Last seen"],
        // The worst eight. A slide holds about that many rows before it stops being
        // read, and the full list is a click away in Analytics.
        rows: recurring
          .slice(0, 8)
          .map((r) => [
            r.targetLabel,
            r.categoryName ?? "Uncategorised",
            String(r.count),
            r.lastSeenAt.toISOString().slice(0, 10),
          ]),
      },
    });
  }

  if (sections.includes("activity")) {
    const [trend, byCategory, byDepartment, bySeverity, byStatus] = await Promise.all([
      insights.issuesOverTime(companyId, from, to),
      insights.issuesByCategory(companyId, from, to),
      pack.issuesByDepartment(scope, from, to),
      pack.issuesBySeverity(scope, from, to),
      insights.entriesByStatus(companyId, from, to),
    ]);
    built.push({
      section: "activity",
      title: "What was filed",
      trend,
      trendTitle: "Issues and work logged through the period",
      series: [
        {
          key: "issuesByCategory",
          title: "Issues by category",
          description: "What kind of thing keeps going wrong.",
          unit: "issues",
          points: byCategory,
        },
        {
          key: "issuesByDepartment",
          title: "Issues by department",
          description: "Which part of the plant is generating the work.",
          unit: "issues",
          points: byDepartment,
        },
        {
          key: "issuesBySeverity",
          title: "Issues by severity",
          description: "Worst first, by your own severity ladder.",
          unit: "issues",
          points: bySeverity,
        },
        {
          key: "entriesByStatus",
          title: "Where entries stand",
          description: "How much is open versus finished.",
          unit: "entries",
          points: byStatus,
        },
      ],
    });
  }

  if (sections.includes("people")) {
    const [byPerson, byDept, entries] = await Promise.all([
      insights.pointsByPerson(companyId, from, to),
      insights.pointsByDepartment(companyId, from, to),
      pack.entriesByPerson(scope, from, to),
    ]);
    built.push({
      section: "people",
      title: "People and points",
      series: [
        {
          key: "pointsByPerson",
          title: "Points by person",
          description: "Confirmed points for work in the period.",
          unit: "pts",
          points: byPerson,
        },
        {
          key: "pointsByDepartment",
          title: "Points by department",
          description: "Where the work is happening, not who did it.",
          unit: "pts",
          points: byDept,
        },
        {
          key: "entriesByPerson",
          title: "Entries filed by person",
          description: "Who is writing things down at all.",
          unit: "entries",
          points: entries,
        },
      ],
    });
  }

  if (sections.includes("compliance")) {
    const [routinesByDept, tasksByPerson] = await Promise.all([
      pack.routinesByDepartment(scope, from, to),
      pack.tasksCompletedByPerson(scope, from, to),
    ]);
    built.push({
      section: "compliance",
      title: "Routines and tasks",
      series: [
        {
          key: "routinesByDepartment",
          title: "Routine completions by department",
          description: "Where the scheduled checks are actually being done.",
          unit: "completions",
          points: routinesByDept,
        },
        {
          key: "tasksByPerson",
          title: "Tasks completed by person",
          description: "Who is clearing the work that was handed out.",
          unit: "tasks",
          points: tasksByPerson,
        },
      ],
    });
  }

  if (sections.includes("cartridges")) {
    const fitted = await pack.cartridgesFitted(scope, from, to);
    // Only when there is something to say. The module is optional, and a section of
    // empty charts on a slide in front of management reads as a broken system rather
    // than as a module this company does not use.
    if (fitted.length > 0) {
      built.push({
        section: "cartridges",
        title: "Cartridges",
        series: [
          {
            key: "cartridgesFitted",
            title: "Cartridges fitted by site",
            description: "Installations recorded in the period.",
            unit: "fitted",
            points: fitted,
          },
        ],
      });
    }
  }

  return {
    window: windowOf(from, to),
    previousWindow: windowOf(previousFrom, previousTo),
    companyName: company?.name ?? "",
    periodLabel: windows.label,
    indicators,
    sections: built,
  };
}
