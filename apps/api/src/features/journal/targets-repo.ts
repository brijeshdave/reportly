// Author: Brijesh Dave <https://github.com/brijeshdave>
// JournalEntry scope repository — the only code touching journal_targets.
//
// Scope is polymorphic (a kind + an id across four tables), so there is no foreign
// key to lean on and two jobs land here: resolving each link to a human label, and
// validating that a link names something inside the caller's own company. A link
// whose thing has since been deleted resolves to nothing and is simply dropped from
// the read — a stale scope row must never take a report down with it.
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  assetTypes,
  assets,
  departmentUsers,
  departments,
  deviceTypes,
  devices,
  journalTargets,
  users,
} from "@/core/db/schema.js";
import type { JournalTarget, JournalTargetInput, TargetKind } from "@reportly/shared";

/** The label for a device reads "Name (tag)" when it carries an identifier. */
function deviceLabel(name: string, identifier: string | null): string {
  return identifier ? `${name} (${identifier})` : name;
}

/**
 * Resolves the labels for a set of targets, one batched query per kind. Returns a
 * map keyed "kind:id"; anything missing from it no longer exists.
 */
interface Labelled {
  label: string;
  /**
   * Whether this thing's TYPE says an outage on it is worth recording.
   *
   * Untyped is `true`: nobody has said either way, and refusing on a fact never
   * recorded loses an outage that did happen. People and departments are never
   * down, so they are false.
   */
  tracksDowntime: boolean;
}

async function labelsFor(targets: { kind: string; id: string }[]): Promise<Map<string, Labelled>> {
  const labels = new Map<string, Labelled>();
  const idsOf = (kind: TargetKind) => targets.filter((t) => t.kind === kind).map((t) => t.id);

  const assetIds = idsOf("asset");
  if (assetIds.length > 0) {
    const rows = await db
      .select({ id: assets.id, name: assets.name, tracks: assetTypes.tracksDowntime })
      .from(assets)
      .leftJoin(assetTypes, eq(assetTypes.id, assets.typeId))
      .where(inArray(assets.id, assetIds));
    for (const r of rows) {
      labels.set(`asset:${r.id}`, { label: r.name, tracksDowntime: r.tracks ?? true });
    }
  }

  const deviceIds = idsOf("device");
  if (deviceIds.length > 0) {
    const rows = await db
      .select({
        id: devices.id,
        name: devices.name,
        identifier: devices.identifier,
        tracks: deviceTypes.tracksDowntime,
      })
      .from(devices)
      .leftJoin(deviceTypes, eq(deviceTypes.id, devices.typeId))
      .where(inArray(devices.id, deviceIds));
    for (const r of rows) {
      labels.set(`device:${r.id}`, {
        label: deviceLabel(r.name, r.identifier),
        tracksDowntime: r.tracks ?? true,
      });
    }
  }

  const userIds = idsOf("user");
  if (userIds.length > 0) {
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const r of rows) labels.set(`user:${r.id}`, { label: r.name, tracksDowntime: false });
  }

  const departmentIds = idsOf("department");
  if (departmentIds.length > 0) {
    const rows = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(inArray(departments.id, departmentIds));
    for (const r of rows) {
      labels.set(`department:${r.id}`, { label: r.name, tracksDowntime: false });
    }
  }

  return labels;
}

/** One report's scope, labelled. Links whose thing is gone are left out. */
export async function targetsFor(reportId: string): Promise<JournalTarget[]> {
  const rows = await db
    .select({ kind: journalTargets.targetKind, id: journalTargets.targetId })
    .from(journalTargets)
    .where(eq(journalTargets.reportId, reportId));

  const labels = await labelsFor(rows);
  return rows
    .map((row) => {
      const found = labels.get(`${row.kind}:${row.id}`);
      return found
        ? {
            kind: row.kind as TargetKind,
            id: row.id,
            label: found.label,
            tracksDowntime: found.tracksDowntime,
          }
        : null;
    })
    .filter((t): t is JournalTarget => t !== null)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

/** Replaces a report's whole scope set in one transaction. */
export async function setTargets(reportId: string, targets: JournalTargetInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(journalTargets).where(eq(journalTargets.reportId, reportId));
    if (targets.length === 0) return;

    // The primary key is (report, kind, id) — de-duplicate so picking the same thing
    // twice in the UI is a no-op rather than a constraint violation.
    const seen = new Set<string>();
    const rows = targets
      .filter((t) => {
        const key = `${t.kind}:${t.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((t) => ({ reportId, targetKind: t.kind, targetId: t.id }));

    await tx.insert(journalTargets).values(rows);
  });
}

/**
 * Which of these targets exist inside this company — the caller compares against
 * what it asked for and rejects the rest, so scope can never name another company's
 * asset, or a person who holds no membership here.
 */
export async function existingTargets(
  companyId: string,
  targets: JournalTargetInput[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const idsOf = (kind: TargetKind) => targets.filter((t) => t.kind === kind).map((t) => t.id);

  const assetIds = idsOf("asset");
  if (assetIds.length > 0) {
    const rows = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(inArray(assets.id, assetIds), eq(assets.companyId, companyId)));
    for (const r of rows) found.add(`asset:${r.id}`);
  }

  const deviceIds = idsOf("device");
  if (deviceIds.length > 0) {
    const rows = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(inArray(devices.id, deviceIds), eq(devices.companyId, companyId)));
    for (const r of rows) found.add(`device:${r.id}`);
  }

  const departmentIds = idsOf("department");
  if (departmentIds.length > 0) {
    const rows = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(inArray(departments.id, departmentIds), eq(departments.companyId, companyId)));
    for (const r of rows) found.add(`department:${r.id}`);
  }

  // A person is "in this company" if they hold a department membership in it — the
  // same rule the reporting line uses for who may be named as a manager.
  const userIds = idsOf("user");
  if (userIds.length > 0) {
    const rows = await db
      .selectDistinct({ id: departmentUsers.userId })
      .from(departmentUsers)
      .innerJoin(departments, eq(departments.id, departmentUsers.departmentId))
      .where(and(inArray(departmentUsers.userId, userIds), eq(departments.companyId, companyId)));
    for (const r of rows) found.add(`user:${r.id}`);
  }

  return found;
}

/**
 * Every asset at or below one asset, plus the devices that live at any of them.
 *
 * This is what makes "the issues on Line 3" mean what a person means by it: the
 * line itself, its stations, and the machines standing at them — without any of
 * those devices ever having been placed in the tree by hand. `CYCLE` makes Postgres
 * stop rather than spin if a parent loop ever reached the table.
 */
export async function scopeUnderAsset(
  assetId: string,
  companyId: string,
): Promise<{ assetIds: string[]; deviceIds: string[] }> {
  const result = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT a.id FROM assets a WHERE a.id = ${assetId} AND a.company_id = ${companyId}
      UNION ALL
      SELECT a.id FROM assets a JOIN subtree s ON a.parent_id = s.id
    ) CYCLE id SET is_cycle USING path
    SELECT id FROM subtree WHERE NOT is_cycle
  `);
  const assetIds = result.rows.map((r) => r.id);
  if (assetIds.length === 0) return { assetIds: [], deviceIds: [] };

  const deviceRows = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(inArray(devices.assetId, assetIds), eq(devices.companyId, companyId)));

  return { assetIds, deviceIds: deviceRows.map((r) => r.id) };
}

/**
 * The ids of reports scoped to any of these things — the roll-up read. Paired with
 * `scopeUnderAsset` it answers "every issue under Line 3, including its devices".
 */
export async function reportIdsForTargets(
  targets: { kind: TargetKind; ids: string[] }[],
): Promise<string[]> {
  const clauses = targets
    .filter((t) => t.ids.length > 0)
    .map((t) =>
      and(eq(journalTargets.targetKind, t.kind), inArray(journalTargets.targetId, t.ids)),
    );
  if (clauses.length === 0) return [];

  const rows = await db
    .selectDistinct({ reportId: journalTargets.reportId })
    .from(journalTargets)
    .where(sql`(${sql.join(clauses, sql` OR `)})`);

  return rows.map((r) => r.reportId);
}
