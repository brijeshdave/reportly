// Author: Brijesh Dave <https://github.com/brijeshdave>
// The only code touching the DB for analytics. Everything here is a read over
// tables other features own — downtime entries, reports, the asset tree — because
// an analytic is a view of records, never a record of its own. Nothing in this
// file writes.
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { AuthContext } from "@reportly/shared";

import { db } from "@/core/db/index.js";
import { withLocationsNullable } from "@/core/db/scoped.js";
import {
  assets,
  categories,
  devices,
  downtimeEntries,
  journalTargets,
  journalEntries,
} from "@/core/db/schema.js";

/** Raw downtime facts for one set of targets over one window. */
export interface DowntimeFactsRaw {
  /** Entries that *started* inside the window. */
  failures: number;
  /** Of those, how many are still open. */
  openCount: number;
  /**
   * Total minutes down, clipped to the window: an outage that began before `from`
   * contributes only its part inside it. Without the clip a single long outage
   * would count its whole length against a window it barely touched, and a
   * one-week view of a month-long failure would report negative operating time.
   */
  totalDowntimeMinutes: number;
  /** Mean duration of the entries closed inside the window. Null = none closed. */
  mttrMinutes: number | null;
}

/**
 * The span of one entry that falls inside [from, to], in minutes, floored at zero.
 *
 * `least`/`greatest` do the clipping: an open entry is treated as running until
 * `to` (not until now — a window that ended last month must not keep growing), and
 * the zero floor keeps a mistyped future start from subtracting real downtime from
 * the same asset's total. This mirrors the floor already in the downtime repo's
 * `totals()`, for the same reason.
 */
const clippedMinutes = (from: Date, to: Date) => sql<number>`
  greatest(
    extract(epoch from (
      least(coalesce(${downtimeEntries.endedAt}, ${to.toISOString()}::timestamptz), ${to.toISOString()}::timestamptz)
      - greatest(${downtimeEntries.startedAt}, ${from.toISOString()}::timestamptz)
    )) / 60,
    0
  )
`;

/**
 * Downtime facts for a set of asset ids and device ids over a window.
 *
 * Targets are matched by (kind, id) against the downtime entries themselves, which
 * is what makes the roll-up honest: downtime is logged once, on the most specific
 * thing that was down, and a subtree's total is the sum of its parts — never a
 * parent's own entry double-counted with its children's.
 */
export async function downtimeFacts(
  companyId: string,
  targets: { assetIds: string[]; deviceIds: string[] },
  from: Date,
  to: Date,
): Promise<DowntimeFactsRaw> {
  const { assetIds, deviceIds } = targets;
  if (assetIds.length === 0 && deviceIds.length === 0) {
    return { failures: 0, openCount: 0, totalDowntimeMinutes: 0, mttrMinutes: null };
  }

  const kindMatches = [];
  if (assetIds.length > 0) {
    kindMatches.push(
      and(eq(downtimeEntries.targetKind, "asset"), inArray(downtimeEntries.targetId, assetIds)),
    );
  }
  if (deviceIds.length > 0) {
    kindMatches.push(
      and(eq(downtimeEntries.targetKind, "device"), inArray(downtimeEntries.targetId, deviceIds)),
    );
  }

  // Started-in-window defines a failure; overlaps-window defines downtime. They are
  // deliberately different predicates: an outage that began yesterday and runs
  // through today is one failure (yesterday's) but contributes minutes to both days.
  const startedInWindow = and(
    gte(downtimeEntries.startedAt, from),
    lt(downtimeEntries.startedAt, to),
  );
  const overlapsWindow = and(
    lt(downtimeEntries.startedAt, to),
    sql`coalesce(${downtimeEntries.endedAt}, 'infinity'::timestamptz) > ${from.toISOString()}::timestamptz`,
  );

  const closedInWindow = and(
    startedInWindow,
    sql`${downtimeEntries.endedAt} is not null`,
    lt(downtimeEntries.endedAt, to),
  );

  const [row] = await db
    .select({
      failures: sql<number>`count(*) filter (where ${startedInWindow})::int`,
      openCount: sql<number>`count(*) filter (where ${startedInWindow} and ${downtimeEntries.endedAt} is null)::int`,
      totalDowntimeMinutes: sql<number>`coalesce(round(sum(${clippedMinutes(from, to)}) filter (where ${overlapsWindow})::numeric, 2), 0)::float8`,
      // avg() over an empty set is NULL, which is exactly the answer we want when
      // nothing has been closed — "no finished repairs" is not "zero minutes".
      mttrMinutes: sql<
        number | null
      >`round(avg(extract(epoch from (${downtimeEntries.endedAt} - ${downtimeEntries.startedAt})) / 60) filter (where ${closedInWindow})::numeric, 2)::float8`,
    })
    .from(downtimeEntries)
    .where(
      and(eq(downtimeEntries.companyId, companyId), sql`(${sql.join(kindMatches, sql` or `)})`),
    );

  return {
    failures: row?.failures ?? 0,
    openCount: row?.openCount ?? 0,
    totalDowntimeMinutes: row?.totalDowntimeMinutes ?? 0,
    mttrMinutes: row?.mttrMinutes ?? null,
  };
}

/** The direct children of an asset — each of which is rolled up in its own right. */
export async function childAssets(
  ctx: AuthContext,
  assetId: string,
  companyId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: assets.id, name: assets.name })
    .from(assets)
    .where(
      and(
        eq(assets.parentId, assetId),
        eq(assets.companyId, companyId),
        // A tree can cross sites — a plant's line under a company-wide root — so
        // the breakdown a reader sees stops where their sites do.
        withLocationsNullable(ctx, assets.locationId),
      ),
    );
}

export async function getAsset(
  ctx: AuthContext,
  assetId: string,
  companyId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: assets.id, name: assets.name })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.companyId, companyId),
        // Naming an asset id you cannot reach must answer "not found", not its
        // figures: this is the door a report opens when somebody types an id.
        withLocationsNullable(ctx, assets.locationId),
      ),
    );
  return row ?? null;
}

export interface RecurringRaw {
  targetKind: string;
  targetId: string;
  targetLabel: string;
  categoryId: string | null;
  categoryName: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  latestReportId: string;
}

/**
 * Things that keep going wrong: issue reports grouped by (target, category).
 *
 * Grouped by category rather than title because "belt snapped" and "belt broke
 * again" are one problem typed twice — the category is the vocabulary the org
 * already agreed on. Only `kind = 'issue'` counts; a work log recurring is just
 * somebody doing their job.
 *
 * `having count(*) > 1` is the whole point: a thing that happened once is not a
 * pattern, and shipping it would bury the four real ones in a thousand rows.
 */
export async function recurringIssues(
  companyId: string,
  from: Date,
  to: Date,
  restrictTo?: { assetIds: string[]; deviceIds: string[] },
): Promise<RecurringRaw[]> {
  const scope = [];
  if (restrictTo) {
    if (restrictTo.assetIds.length > 0) {
      scope.push(
        and(
          eq(journalTargets.targetKind, "asset"),
          inArray(journalTargets.targetId, restrictTo.assetIds),
        ),
      );
    }
    if (restrictTo.deviceIds.length > 0) {
      scope.push(
        and(
          eq(journalTargets.targetKind, "device"),
          inArray(journalTargets.targetId, restrictTo.deviceIds),
        ),
      );
    }
    // Asked to narrow to a subtree that holds nothing — the honest answer is no
    // rows, not "the whole company".
    if (scope.length === 0) return [];
  }

  const rows = await db
    .select({
      targetKind: journalTargets.targetKind,
      targetId: journalTargets.targetId,
      // Resolved per kind, falling back to the raw id: a target whose asset or
      // device has since been deleted still counts as a recurrence — it happened —
      // and dropping the row would quietly shrink the count.
      targetLabel: sql<string>`coalesce(max(${assets.name}), max(${devices.name}), max(${journalTargets.targetId}))`,
      categoryId: journalEntries.categoryId,
      categoryName: sql<string | null>`max(${categories.name})`,
      count: sql<number>`count(distinct ${journalEntries.id})::int`,
      firstSeenAt: sql<Date>`min(${journalEntries.reportDate})`,
      lastSeenAt: sql<Date>`max(${journalEntries.reportDate})`,
      latestReportId: sql<string>`(array_agg(${journalEntries.id} order by ${journalEntries.reportDate} desc))[1]`,
    })
    .from(journalTargets)
    .innerJoin(journalEntries, eq(journalEntries.id, journalTargets.reportId))
    .leftJoin(categories, eq(categories.id, journalEntries.categoryId))
    // `target_id` is text — polymorphic, and holds a user id as readily as a uuid —
    // so the id side is cast to text to meet it, never the other way round. Casting
    // `target_id::uuid` would ask Postgres to parse every non-uuid id in the table
    // and fail on the first one. Same joins as the downtime repo, same reason.
    .leftJoin(
      assets,
      sql`${journalTargets.targetKind} = 'asset' and ${assets.id}::text = ${journalTargets.targetId}`,
    )
    .leftJoin(
      devices,
      sql`${journalTargets.targetKind} = 'device' and ${devices.id}::text = ${journalTargets.targetId}`,
    )
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.kind, "issue"),
        eq(journalEntries.state, "submitted"),
        gte(journalEntries.reportDate, from),
        lt(journalEntries.reportDate, to),
        scope.length > 0 ? sql`(${sql.join(scope, sql` or `)})` : undefined,
      ),
    )
    .groupBy(journalTargets.targetKind, journalTargets.targetId, journalEntries.categoryId)
    .having(sql`count(distinct ${journalEntries.id}) > 1`)
    .orderBy(sql`count(distinct ${journalEntries.id}) desc`);

  return rows.map((r) => ({
    ...r,
    firstSeenAt: new Date(r.firstSeenAt),
    lastSeenAt: new Date(r.lastSeenAt),
  }));
}
