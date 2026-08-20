// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reports repository — the reads that back generated reports, and the CRUD for the
// saved report views. Two concerns live here:
//
//   1. `reportRows` — the journal rows a report is built from. It reuses the
//      journal's own `visibilityScope` and location scope verbatim, then narrows to
//      submitted entries in the window and applies the report's filters. The rows a
//      report can ever contain are therefore a subset of what the caller could open
//      in the journal — a report is never a way around scope.
//   2. `report_views` / `report_view_groups` — the saved definitions and their
//      group audiences.
import { type AnyColumn, type SQL, and, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import type { AuthContext } from "@reportly/shared";

import { withLocationsNullable } from "@/core/db/scoped.js";
import {
  assets,
  departments,
  devices,
  downtimeEntries,
  groupUsers,
  journalEntries,
  journalScores,
  journalStatuses,
  journalTargets,
  pointAwards,
  reportViewGroups,
  reportViews,
  users,
} from "@/core/db/schema.js";
import {
  type JournalEntryRowRaw,
  selectReports,
  visibilityScope,
} from "@/features/journal/repo.js";
import { scopeUnderAsset } from "@/features/journal/targets-repo.js";
import type { ReportDefinition, ReportFilters, ReportViewAccess } from "@reportly/shared";

/** Turn the report's filters into WHERE fragments over the journal's joined tables. */
function filterConditions(filters: ReportFilters): SQL[] {
  const conds: SQL[] = [];
  const anyOf = (column: AnyColumn, ids: string[] | undefined) => {
    if (ids && ids.length > 0) conds.push(inArray(column, ids));
  };
  anyOf(journalEntries.locationId, filters.locationId);
  anyOf(journalEntries.departmentId, filters.departmentId);
  anyOf(journalEntries.categoryId, filters.categoryId);
  anyOf(journalEntries.authorId, filters.authorId);
  anyOf(journalEntries.assigneeId, filters.assigneeId);
  anyOf(journalEntries.severityId, filters.severityId);
  anyOf(journalEntries.statusId, filters.statusId);
  if (filters.kind) conds.push(eq(journalEntries.kind, filters.kind));
  // Only entries that are a recurrence of an earlier one.
  if (filters.recurring) conds.push(sql`${journalEntries.recurrenceOfId} IS NOT NULL`);
  // Only entries not yet in a terminal status (still open / ageing). A null status
  // counts as open — it has not been resolved.
  if (filters.openOnly) {
    conds.push(
      sql`(${journalEntries.statusId} IS NULL OR ${journalStatuses.isTerminal} IS NOT TRUE)`,
    );
  }
  if (filters.tagId && filters.tagId.length > 0) {
    conds.push(sql`EXISTS (
      SELECT 1 FROM taggables tg
      WHERE tg.owner_type = 'report' AND tg.owner_id = ${journalEntries.id}
        AND tg.tag_id IN (${sql.join(
          filters.tagId.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
    )`);
  }
  // Entries about a particular asset or device — what the entry is tagged to. Both
  // fold into one EXISTS on `journal_targets`; asset and device ids are distinct
  // uuids, so a single `target_id IN (…)` cannot confuse the two. `target_id` is
  // text, so the ids are matched as text (no cast).
  const targetIds = [...(filters.assetId ?? []), ...(filters.deviceId ?? [])];
  if (targetIds.length > 0) {
    conds.push(sql`EXISTS (
      SELECT 1 FROM ${journalTargets} jt
      WHERE jt.report_id = ${journalEntries.id}
        AND jt.target_id IN (${sql.join(
          targetIds.map((id) => sql`${id}`),
          sql`, `,
        )})
    )`);
  }
  return conds;
}

/**
 * The journal rows a report covers: submitted entries filed in [from, to), visible
 * to the caller (reporting line), at a location the caller may reach, in the active
 * company, matching the definition's filters. Ordered by date for a stable report.
 *
 * A report is a record of filed work, so drafts are excluded outright — hence the
 * `state = 'submitted'` on top of the shared visibility rule (which would otherwise
 * also admit the caller's own drafts).
 */
export async function reportRows(
  definition: ReportDefinition,
  from: Date,
  to: Date,
  callerId: string,
  visibleAuthorIds: string[] | null,
  companyId: string | null,
  locationScope: SQL | undefined,
): Promise<JournalEntryRowRaw[]> {
  const where = and(
    visibilityScope(callerId, visibleAuthorIds),
    eq(journalEntries.state, "submitted"),
    companyId ? eq(journalEntries.companyId, companyId) : undefined,
    locationScope,
    gte(journalEntries.reportDate, from),
    lt(journalEntries.reportDate, to),
    ...filterConditions(definition.filters),
  );
  return selectReports().where(where).orderBy(journalEntries.reportDate);
}

/**
 * Total official points per entry: for each worker, the review score if their
 * manager entered one, otherwise their self score; summed over the entry's workers.
 * Returned as a map keyed by report id, for the given ids only.
 */
export async function pointsByReport(reportIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (reportIds.length === 0) return map;
  const rows = await db
    .select({
      reportId: journalScores.reportId,
      tier: journalScores.tier,
      subjectUserId: journalScores.subjectUserId,
      points: journalScores.points,
    })
    .from(journalScores)
    .where(inArray(journalScores.reportId, reportIds));

  // review overrides self per (report, subject), then sum per report.
  const perSubject = new Map<string, { self: number; review: number | null }>();
  for (const r of rows) {
    const key = `${r.reportId}:${r.subjectUserId}`;
    const cur = perSubject.get(key) ?? { self: 0, review: null };
    if (r.tier === "review") cur.review = r.points;
    else cur.self = r.points;
    perSubject.set(key, cur);
  }
  for (const [key, v] of perSubject) {
    const reportId = key.slice(0, key.lastIndexOf(":"));
    const official = v.review ?? v.self;
    map.set(reportId, (map.get(reportId) ?? 0) + official);
  }
  return map;
}

/**
 * Asset and device labels for a set of entries, as `reportId → labels[]`.
 *
 * `journal_targets.target_id` is text (the scope is polymorphic — asset, device,
 * user…), so it is not joined directly to `assets.id`/`devices.id` (uuid): the target
 * rows are read first, then the labels looked up by id with `inArray`, which casts
 * cleanly. This mirrors the journal's own `labelsFor`.
 */
export async function assetLabelsByReport(reportIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (reportIds.length === 0) return map;

  const targetRows = await db
    .select({
      reportId: journalTargets.reportId,
      kind: journalTargets.targetKind,
      targetId: journalTargets.targetId,
    })
    .from(journalTargets)
    .where(
      and(
        inArray(journalTargets.targetKind, ["asset", "device"]),
        inArray(journalTargets.reportId, reportIds),
      ),
    );
  if (targetRows.length === 0) return map;

  const assetIds = targetRows.filter((r) => r.kind === "asset").map((r) => r.targetId);
  const deviceIds = targetRows.filter((r) => r.kind === "device").map((r) => r.targetId);

  const assetName = new Map<string, string>();
  if (assetIds.length > 0) {
    const rows = await db
      .select({ id: assets.id, name: assets.name })
      .from(assets)
      .where(inArray(assets.id, assetIds));
    for (const r of rows) assetName.set(r.id, r.name);
  }
  const deviceLabel = new Map<string, string>();
  if (deviceIds.length > 0) {
    const rows = await db
      .select({ id: devices.id, name: devices.name, identifier: devices.identifier })
      .from(devices)
      .where(inArray(devices.id, deviceIds));
    for (const r of rows)
      deviceLabel.set(r.id, r.identifier ? `${r.name} (${r.identifier})` : r.name);
  }

  for (const r of targetRows) {
    const label = r.kind === "asset" ? assetName.get(r.targetId) : deviceLabel.get(r.targetId);
    if (!label) continue;
    const list = map.get(r.reportId) ?? [];
    list.push(label);
    map.set(r.reportId, list);
  }
  for (const [, list] of map) list.sort((a, b) => a.localeCompare(b));
  return map;
}

// --- downtime source ---

export interface DowntimeReportRow {
  id: string;
  reportId: string;
  targetLabel: string | null;
  targetId: string;
  reason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  createdByName: string;
}

/** The asset (and device) ids under an asset, as text — for scoping downtime. */
export async function assetSubtreeTargetIds(
  assetId: string,
  companyId: string | null,
): Promise<string[]> {
  if (!companyId) return [];
  const { assetIds, deviceIds } = await scopeUnderAsset(assetId, companyId);
  return [...assetIds, ...deviceIds];
}

export async function assetNameOf(
  assetId: string,
  companyId: string | null,
): Promise<string | null> {
  if (!companyId) return null;
  const [row] = await db
    .select({ name: assets.name })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.companyId, companyId)));
  return row?.name ?? null;
}

/** Active root assets (no parent) — the rows of a company-wide reliability report. */
export async function rootAssets(
  ctx: AuthContext,
  companyId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: assets.id, name: assets.name })
    .from(assets)
    .where(
      and(
        eq(assets.companyId, companyId),
        // An unplaced asset is visible to everybody; one at a site is visible to
        // the people who can reach that site. Reliability is rolled up from these
        // roots, so an unscoped list here is another plant's figures on the page.
        withLocationsNullable(ctx, assets.locationId),
        sql`${assets.parentId} IS NULL`,
        eq(assets.status, "active"),
      ),
    )
    .orderBy(assets.name);
}

/** A device's display label — "Name (tag)" when it carries an identifier. */
const deviceLabelCol = sql<string>`case when ${devices.identifier} is null then ${devices.name}
  else ${devices.name} || ' (' || ${devices.identifier} || ')' end`;

/**
 * Devices for a per-device reliability report: those under an asset's subtree when
 * one is chosen, otherwise every device in the company. Ordered by name.
 */
export async function devicesForReliability(
  companyId: string,
  assetId: string | null,
): Promise<{ id: string; name: string }[]> {
  if (assetId) {
    const deviceIds = (await scopeUnderAsset(assetId, companyId)).deviceIds;
    if (deviceIds.length === 0) return [];
    const rows = await db
      .select({ id: devices.id, name: deviceLabelCol })
      .from(devices)
      .where(and(eq(devices.companyId, companyId), inArray(devices.id, deviceIds)))
      .orderBy(devices.name);
    return rows;
  }
  return db
    .select({ id: devices.id, name: deviceLabelCol })
    .from(devices)
    .where(eq(devices.companyId, companyId))
    .orderBy(devices.name);
}

const downtimeLabel = sql<string | null>`coalesce(
  ${assets.name},
  case when ${devices.identifier} is null then ${devices.name}
       else ${devices.name} || ' (' || ${devices.identifier} || ')' end
)`;

/**
 * Downtime entries whose outage started in [from, to), for reports the caller may
 * see (same journal visibility + location scope), optionally scoped to an asset
 * subtree. Ordered oldest-first.
 */
export async function downtimeRows(
  from: Date,
  to: Date,
  callerId: string,
  visibleAuthorIds: string[] | null,
  companyId: string | null,
  locationScope: SQL | undefined,
  scopeTargetIds: string[] | null,
): Promise<DowntimeReportRow[]> {
  const scopeCond =
    scopeTargetIds === null
      ? undefined
      : scopeTargetIds.length === 0
        ? sql`false`
        : inArray(downtimeEntries.targetId, scopeTargetIds);

  return db
    .select({
      id: downtimeEntries.id,
      reportId: downtimeEntries.reportId,
      targetLabel: downtimeLabel,
      targetId: downtimeEntries.targetId,
      reason: downtimeEntries.reason,
      startedAt: downtimeEntries.startedAt,
      endedAt: downtimeEntries.endedAt,
      createdByName: users.name,
    })
    .from(downtimeEntries)
    .innerJoin(users, eq(users.id, downtimeEntries.createdBy))
    .innerJoin(journalEntries, eq(journalEntries.id, downtimeEntries.reportId))
    .leftJoin(
      assets,
      sql`${downtimeEntries.targetKind} = 'asset' and ${assets.id}::text = ${downtimeEntries.targetId}`,
    )
    .leftJoin(
      devices,
      sql`${downtimeEntries.targetKind} = 'device' and ${devices.id}::text = ${downtimeEntries.targetId}`,
    )
    .where(
      and(
        companyId ? eq(downtimeEntries.companyId, companyId) : undefined,
        gte(downtimeEntries.startedAt, from),
        lt(downtimeEntries.startedAt, to),
        visibilityScope(callerId, visibleAuthorIds),
        locationScope,
        scopeCond,
      ),
    )
    .orderBy(downtimeEntries.startedAt);
}

// --- leaderboard source ---

export interface LeaderboardRaw {
  userId: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  own: number;
  team: number;
}

/**
 * Points earned by each person over a window, from the `point_awards` ledger — the
 * same ledger `pointsFor` reads, so a leaderboard total matches "my points" exactly.
 * Split into `own` (direct) and `team` (the decaying rollup from their downline), and
 * attributed to the department carried on the award (a person may appear under several;
 * a routine award carries none). Windowed by `earned_on`, scoped to the company, and
 * optionally to a set of beneficiaries the caller may see. Reads the ledger directly —
 * no journal join — so journal and routine points count together.
 */
export async function leaderboardRows(
  companyId: string,
  from: Date,
  to: Date,
  visibleUserIds: string[] | null,
): Promise<LeaderboardRaw[]> {
  if (visibleUserIds && visibleUserIds.length === 0) return [];
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  return db
    .select({
      userId: pointAwards.beneficiaryUserId,
      name: users.name,
      departmentId: pointAwards.departmentId,
      departmentName: departments.name,
      own: sql<number>`coalesce(sum(${pointAwards.points}) filter (where ${pointAwards.kind} = 'direct'), 0)::real`,
      team: sql<number>`coalesce(sum(${pointAwards.points}) filter (where ${pointAwards.kind} = 'rollup'), 0)::real`,
    })
    .from(pointAwards)
    .innerJoin(users, eq(users.id, pointAwards.beneficiaryUserId))
    .leftJoin(departments, eq(departments.id, pointAwards.departmentId))
    .where(
      and(
        eq(pointAwards.companyId, companyId),
        // Someone opted out of the standings is left out entirely, points and all.
        eq(users.countsOnLeaderboard, true),
        gte(pointAwards.earnedOn, fromDate),
        lt(pointAwards.earnedOn, toDate),
        visibleUserIds ? inArray(pointAwards.beneficiaryUserId, visibleUserIds) : undefined,
      ),
    )
    .groupBy(pointAwards.beneficiaryUserId, users.name, pointAwards.departmentId, departments.name);
}

export async function departmentNameOf(
  departmentId: string,
  companyId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ name: departments.name })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)));
  return row?.name ?? null;
}

/** The group ids the caller belongs to — for resolving `groups`-access views. */
export async function groupIdsForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupUsers.groupId })
    .from(groupUsers)
    .where(eq(groupUsers.userId, userId));
  return rows.map((r) => r.groupId);
}

// --- report views ---

export interface ReportViewRow {
  id: string;
  companyId: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  ownerId: string | null;
  ownerName: string | null;
  access: string;
  definition: unknown;
  createdAt: Date;
  updatedAt: Date;
  groupIds: string[];
}

/** Every view rows the reader might be offered: system views + this company's own. */
export async function listViewRows(companyId: string | null): Promise<ReportViewRow[]> {
  const rows = await db
    .select({
      id: reportViews.id,
      companyId: reportViews.companyId,
      name: reportViews.name,
      description: reportViews.description,
      isSystem: reportViews.isSystem,
      ownerId: reportViews.ownerId,
      access: reportViews.access,
      definition: reportViews.definition,
      createdAt: reportViews.createdAt,
      updatedAt: reportViews.updatedAt,
    })
    .from(reportViews)
    .where(
      companyId
        ? sql`(${reportViews.isSystem} = true OR ${reportViews.companyId} = ${companyId})`
        : eq(reportViews.isSystem, true),
    );
  return hydrate(rows);
}

export async function getViewRow(id: string): Promise<ReportViewRow | null> {
  const [row] = await db
    .select({
      id: reportViews.id,
      companyId: reportViews.companyId,
      name: reportViews.name,
      description: reportViews.description,
      isSystem: reportViews.isSystem,
      ownerId: reportViews.ownerId,
      access: reportViews.access,
      definition: reportViews.definition,
      createdAt: reportViews.createdAt,
      updatedAt: reportViews.updatedAt,
    })
    .from(reportViews)
    .where(eq(reportViews.id, id));
  if (!row) return null;
  const [full] = await hydrate([row]);
  return full ?? null;
}

/** Attach owner names and group grants to a set of view rows in two batched reads. */
async function hydrate(
  rows: Omit<ReportViewRow, "ownerName" | "groupIds">[],
): Promise<ReportViewRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const grantRows = await db
    .select({ reportViewId: reportViewGroups.reportViewId, groupId: reportViewGroups.groupId })
    .from(reportViewGroups)
    .where(inArray(reportViewGroups.reportViewId, ids));
  const groupsByView = new Map<string, string[]>();
  for (const g of grantRows) {
    const list = groupsByView.get(g.reportViewId) ?? [];
    list.push(g.groupId);
    groupsByView.set(g.reportViewId, list);
  }

  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => Boolean(v)))];
  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const owners = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, ownerIds));
    for (const o of owners) ownerNames.set(o.id, o.name);
  }

  return rows.map((r) => ({
    ...r,
    ownerName: r.ownerId ? (ownerNames.get(r.ownerId) ?? null) : null,
    groupIds: groupsByView.get(r.id) ?? [],
  }));
}

export interface InsertReportView {
  companyId: string;
  name: string;
  description: string | null;
  ownerId: string;
  access: ReportViewAccess;
  definition: ReportDefinition;
}

export async function insertView(input: InsertReportView, groupIds: string[]): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(reportViews)
      .values({
        companyId: input.companyId,
        name: input.name,
        description: input.description,
        ownerId: input.ownerId,
        access: input.access,
        definition: input.definition,
        isSystem: false,
      })
      .returning({ id: reportViews.id });
    const id = row!.id;
    await replaceGroupsTx(tx, id, input.access === "groups" ? groupIds : []);
    return id;
  });
}

export interface PatchReportView {
  name?: string;
  description?: string | null;
  access?: ReportViewAccess;
  definition?: ReportDefinition;
}

export async function updateViewRow(
  id: string,
  patch: PatchReportView,
  groupIds: string[] | undefined,
): Promise<void> {
  await db.transaction(async (tx) => {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.access !== undefined) set.access = patch.access;
    if (patch.definition !== undefined) set.definition = patch.definition;
    await tx.update(reportViews).set(set).where(eq(reportViews.id, id));

    // Rewriting the audience: explicit groups, or cleared if access left "groups".
    if (groupIds !== undefined) await replaceGroupsTx(tx, id, groupIds);
    if (patch.access !== undefined && patch.access !== "groups") {
      await tx.delete(reportViewGroups).where(eq(reportViewGroups.reportViewId, id));
    }
  });
}

export async function deleteViewRow(id: string): Promise<void> {
  await db.delete(reportViews).where(eq(reportViews.id, id));
}

async function replaceGroupsTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  reportViewId: string,
  groupIds: string[],
): Promise<void> {
  await tx.delete(reportViewGroups).where(eq(reportViewGroups.reportViewId, reportViewId));
  const unique = [...new Set(groupIds)];
  if (unique.length > 0) {
    await tx.insert(reportViewGroups).values(unique.map((groupId) => ({ reportViewId, groupId })));
  }
}
