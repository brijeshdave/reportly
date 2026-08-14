// Author: Brijesh Dave <https://github.com/brijeshdave>
// Downtime repository — the only code touching downtime_entries. Labels for the
// thing that was down are resolved by left-joining both possible tables and taking
// whichever matched, since the link is polymorphic (asset or device) and carries no
// foreign key of its own.
import { type SQL, and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { assets, devices, downtimeEntries, journalEntries, users } from "@/core/db/schema.js";

export interface DowntimeRowRaw {
  id: string;
  companyId: string;
  reportId: string;
  targetKind: string;
  targetId: string;
  targetLabel: string | null;
  reason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Whichever of the two joins matched — an asset name, or a device name (+ tag). */
const targetLabel = sql<string | null>`coalesce(
  ${assets.name},
  case when ${devices.identifier} is null then ${devices.name}
       else ${devices.name} || ' (' || ${devices.identifier} || ')' end
)`;

// `target_id` is text — it is polymorphic and has to hold a user id as readily as a
// uuid — so the id side is cast to text to meet it. Casting the other way would ask
// Postgres to parse every non-uuid id as a uuid and fail on the first one.
const onAsset = sql`${downtimeEntries.targetKind} = 'asset' and ${assets.id}::text = ${downtimeEntries.targetId}`;
const onDevice = sql`${downtimeEntries.targetKind} = 'device' and ${devices.id}::text = ${downtimeEntries.targetId}`;

const cols = {
  id: downtimeEntries.id,
  companyId: downtimeEntries.companyId,
  reportId: downtimeEntries.reportId,
  targetKind: downtimeEntries.targetKind,
  targetId: downtimeEntries.targetId,
  targetLabel,
  reason: downtimeEntries.reason,
  startedAt: downtimeEntries.startedAt,
  endedAt: downtimeEntries.endedAt,
  createdBy: downtimeEntries.createdBy,
  createdByName: users.name,
  createdAt: downtimeEntries.createdAt,
  updatedAt: downtimeEntries.updatedAt,
};

function selectEntries() {
  return db
    .select(cols)
    .from(downtimeEntries)
    .innerJoin(users, eq(users.id, downtimeEntries.createdBy))
    .leftJoin(assets, onAsset)
    .leftJoin(devices, onDevice);
}

export async function getEntry(id: string, companyId: string): Promise<DowntimeRowRaw | null> {
  const [row] = await selectEntries().where(
    and(eq(downtimeEntries.id, id), eq(downtimeEntries.companyId, companyId)),
  );
  return row ?? null;
}

/** Every downtime entry raised from one report, newest outage first. */
export async function entriesForReport(reportId: string): Promise<DowntimeRowRaw[]> {
  return selectEntries()
    .where(eq(downtimeEntries.reportId, reportId))
    .orderBy(sql`${downtimeEntries.startedAt} desc`);
}

/**
 * The open entries — the pending queue. `authorIds` limits it to reports by people
 * the caller may see; null means every author (superadmin).
 */
export async function openEntries(
  companyId: string,
  authorIds: string[] | null,
  locationScope: SQL | undefined,
): Promise<DowntimeRowRaw[]> {
  // An empty visible set must match nothing, not everything — inArray on [] is a
  // false condition, which is exactly right, but be explicit about it.
  const visible: SQL | undefined = authorIds
    ? inArray(journalEntries.authorId, authorIds)
    : undefined;
  if (authorIds && authorIds.length === 0) return [];

  return db
    .select(cols)
    .from(downtimeEntries)
    .innerJoin(users, eq(users.id, downtimeEntries.createdBy))
    .innerJoin(journalEntries, eq(journalEntries.id, downtimeEntries.reportId))
    .leftJoin(assets, onAsset)
    .leftJoin(devices, onDevice)
    .where(
      and(
        eq(downtimeEntries.companyId, companyId),
        isNull(downtimeEntries.endedAt),
        visible,
        locationScope,
      ),
    )
    .orderBy(downtimeEntries.startedAt);
}

/**
 * Open entries this person opened themselves — the "you left something running"
 * tile on the home screen.
 *
 * Deliberately narrower than `openEntries`, which is the company-wide pending
 * queue across a manager's downline. A manager's home screen must nag them about
 * their own unclosed outage, not about all forty of their team's: a to-do list
 * that lists other people's work is a to-do list people stop reading.
 */
export async function openEntriesCreatedBy(
  companyId: string,
  userId: string,
): Promise<DowntimeRowRaw[]> {
  return selectEntries()
    .where(
      and(
        eq(downtimeEntries.companyId, companyId),
        eq(downtimeEntries.createdBy, userId),
        isNull(downtimeEntries.endedAt),
      ),
    )
    .orderBy(downtimeEntries.startedAt);
}

export interface NewDowntime {
  companyId: string;
  reportId: string;
  targetKind: string;
  targetId: string;
  startedAt: Date;
  endedAt: Date | null;
  reason: string | null;
  createdBy: string;
}

export async function insertEntry(values: NewDowntime): Promise<string> {
  const [row] = await db
    .insert(downtimeEntries)
    .values(values)
    .returning({ id: downtimeEntries.id });
  return row!.id;
}

export type DowntimePatch = Partial<Pick<NewDowntime, "startedAt" | "endedAt" | "reason">>;

export async function updateEntry(
  id: string,
  companyId: string,
  fields: DowntimePatch,
): Promise<void> {
  await db
    .update(downtimeEntries)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(downtimeEntries.id, id), eq(downtimeEntries.companyId, companyId)));
}

export async function deleteEntry(id: string, companyId: string): Promise<void> {
  await db
    .delete(downtimeEntries)
    .where(and(eq(downtimeEntries.id, id), eq(downtimeEntries.companyId, companyId)));
}

export interface DowntimeTotalRaw {
  targetKind: string;
  targetId: string;
  targetLabel: string | null;
  totalMinutes: number;
  openCount: number;
  entryCount: number;
}

/**
 * Total downtime per thing — the number the whole feature exists to produce.
 *
 * A still-open outage counts up to *now*, which is what makes a running breakdown
 * visible in the total rather than reading as zero until somebody closes it. The sum
 * is over each entry's own span, so two overlapping outages on the same thing are
 * two entries and are counted as such; one entry is never double-counted.
 *
 * Each span is floored at zero *before* it is summed. An open entry whose start is
 * in the future — a mistyped date, a client clock running ahead — otherwise counts
 * as negative time, and a negative contribution would quietly eat real downtime from
 * the same thing's total. Nothing was ever down for less than no time.
 *
 * `locationScope` constrains on the **report** the entry was raised from — an
 * outage inherits the location of the work that reported it, which is the only
 * location a downtime entry has, and is why `reports` is joined here at all.
 */
export async function totals(
  companyId: string,
  locationScope: SQL | undefined,
): Promise<DowntimeTotalRaw[]> {
  const totalMinutes = sql<number>`round(sum(greatest(
    extract(epoch from (coalesce(${downtimeEntries.endedAt}, now()) - ${downtimeEntries.startedAt})) / 60,
    0
  ))::numeric, 2)::float8`;

  const rows = await db
    .select({
      targetKind: downtimeEntries.targetKind,
      targetId: downtimeEntries.targetId,
      targetLabel,
      totalMinutes,
      openCount: sql<number>`count(*) filter (where ${downtimeEntries.endedAt} is null)::int`,
      entryCount: sql<number>`count(*)::int`,
    })
    .from(downtimeEntries)
    .innerJoin(journalEntries, eq(journalEntries.id, downtimeEntries.reportId))
    .leftJoin(assets, onAsset)
    .leftJoin(devices, onDevice)
    .where(and(eq(downtimeEntries.companyId, companyId), locationScope))
    .groupBy(
      downtimeEntries.targetKind,
      downtimeEntries.targetId,
      assets.name,
      devices.name,
      devices.identifier,
    )
    // Worst offender first — the thing that costs the most time is the point.
    .orderBy(sql`${totalMinutes} desc`);

  return rows;
}

/** The report an entry hangs off — for the "may I touch this?" check. */
export async function reportOf(
  reportId: string,
  companyId: string,
): Promise<{
  id: string;
  authorId: string;
  locationId: string | null;
  // Carried for the notification: an outage concerns the department that owns the
  // asset, and the title is what the message is about.
  departmentId: string | null;
  title: string;
} | null> {
  const [row] = await db
    .select({
      id: journalEntries.id,
      authorId: journalEntries.authorId,
      locationId: journalEntries.locationId,
      departmentId: journalEntries.departmentId,
      title: journalEntries.title,
    })
    .from(journalEntries)
    .where(and(eq(journalEntries.id, reportId), eq(journalEntries.companyId, companyId)));
  return row ?? null;
}

/** That the report names this thing in its scope (downtime rides on the report's
 * scope — you cannot record an outage on something the report is not about). */
export async function reportTargetsThing(
  reportId: string,
  kind: string,
  id: string,
): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM journal_targets
      WHERE report_id = ${reportId} AND target_kind = ${kind} AND target_id = ${id}
    ) AS exists
  `);
  return result.rows[0]?.exists === true;
}
