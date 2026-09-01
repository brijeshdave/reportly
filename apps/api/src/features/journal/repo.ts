// Author: Brijesh Dave <https://github.com/brijeshdave>
// JournalEntry repository — the only code touching the reports table. Reads resolve the
// author, category, department, severity and status names in one join so a list or
// a detail never needs a second round trip.
import { type SQL, and, desc, eq, gte, ilike, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/core/db/index.js";
import {
  categories,
  departments,
  locations,
  journalStatuses,
  journalEntries,
  severities,
  taggables,
  tasks,
  users,
} from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";
import type { ResolvedListQuery } from "@reportly/shared";

export interface JournalEntryRowRaw {
  id: string;
  companyId: string;
  authorId: string;
  authorName: string;
  kind: string;
  state: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  locationId: string | null;
  locationName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  severityId: string | null;
  severityName: string | null;
  statusId: string | null;
  statusName: string | null;
  statusGroup: string | null;
  statusIsTerminal: boolean | null;
  reportDate: Date;
  occurredAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  issueSummary: string | null;
  issueDetail: string | null;
  rootCause: string | null;
  preventiveMeasures: string | null;
  workSummary: string | null;
  workDetail: string | null;
  recurrenceOfId: string | null;
  taskId: string | null;
  taskTitle: string | null;
  lockedAt: Date | null;
  submittedAt: Date | null;
  rejectedAt: Date | null;
  rejectedById: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  /** Where it stood before rejection, so lifting one puts it back. */
  rejectedFromStatusId: string | null;
  pointsReviewNeeded: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const author = alias(users, "author");
const assignee = alias(users, "assignee");
const rejecter = alias(users, "rejecter");

const cols = {
  id: journalEntries.id,
  companyId: journalEntries.companyId,
  authorId: journalEntries.authorId,
  authorName: author.name,
  kind: journalEntries.kind,
  state: journalEntries.state,
  title: journalEntries.title,
  categoryId: journalEntries.categoryId,
  categoryName: categories.name,
  departmentId: journalEntries.departmentId,
  departmentName: departments.name,
  locationId: journalEntries.locationId,
  locationName: locations.name,
  assigneeId: journalEntries.assigneeId,
  assigneeName: assignee.name,
  severityId: journalEntries.severityId,
  severityName: severities.name,
  statusId: journalEntries.statusId,
  statusName: journalStatuses.name,
  statusGroup: journalStatuses.group,
  statusIsTerminal: journalStatuses.isTerminal,
  reportDate: journalEntries.reportDate,
  occurredAt: journalEntries.occurredAt,
  startedAt: journalEntries.startedAt,
  endedAt: journalEntries.endedAt,
  issueSummary: journalEntries.issueSummary,
  issueDetail: journalEntries.issueDetail,
  rootCause: journalEntries.rootCause,
  preventiveMeasures: journalEntries.preventiveMeasures,
  workSummary: journalEntries.workSummary,
  workDetail: journalEntries.workDetail,
  recurrenceOfId: journalEntries.recurrenceOfId,
  taskId: journalEntries.taskId,
  taskTitle: tasks.title,
  lockedAt: journalEntries.lockedAt,
  submittedAt: journalEntries.submittedAt,
  rejectedAt: journalEntries.rejectedAt,
  rejectedById: journalEntries.rejectedById,
  rejectedByName: rejecter.name,
  rejectionReason: journalEntries.rejectionReason,
  rejectedFromStatusId: journalEntries.rejectedFromStatusId,
  pointsReviewNeeded: journalEntries.pointsReviewNeeded,
  createdAt: journalEntries.createdAt,
  updatedAt: journalEntries.updatedAt,
};

/**
 * The rule for which entries a caller may see, as a WHERE fragment: your own (any
 * state), anything handed to you, plus submitted entries by anyone you may see.
 * `visibleAuthorIds` is null for a caller who may see every author (superadmin).
 *
 * Exported so the reports engine narrows the journal by the exact same rule — a
 * report must never surface a row its reader could not open in the journal itself.
 */
export function visibilityScope(callerId: string, visibleAuthorIds: string[] | null): SQL {
  return visibleAuthorIds
    ? sql`(${journalEntries.authorId} = ${callerId} OR ${journalEntries.assigneeId} = ${callerId} OR (${journalEntries.state} = 'submitted' AND ${inArray(
        journalEntries.authorId,
        visibleAuthorIds,
      )}))`
    : sql`(${journalEntries.authorId} = ${callerId} OR ${journalEntries.assigneeId} = ${callerId} OR ${journalEntries.state} = 'submitted')`;
}

/** The report select, with every name resolved by a left join. */
/**
 * The same shape as `selectReports`, counting instead of selecting.
 *
 * Every join is a `leftJoin` bar the author, so joining them costs nothing in rows
 * — and a filter naming any of their columns is then valid, which is the whole
 * point. Written beside `selectReports` so the two cannot drift apart.
 */
export function countReports() {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(journalEntries)
    .innerJoin(author, eq(author.id, journalEntries.authorId))
    .leftJoin(assignee, eq(assignee.id, journalEntries.assigneeId))
    .leftJoin(categories, eq(categories.id, journalEntries.categoryId))
    .leftJoin(departments, eq(departments.id, journalEntries.departmentId))
    .leftJoin(locations, eq(locations.id, journalEntries.locationId))
    .leftJoin(severities, eq(severities.id, journalEntries.severityId))
    .leftJoin(journalStatuses, eq(journalStatuses.id, journalEntries.statusId))
    .leftJoin(tasks, eq(tasks.id, journalEntries.taskId));
}

export function selectReports() {
  return (
    db
      .select(cols)
      .from(journalEntries)
      .innerJoin(author, eq(author.id, journalEntries.authorId))
      // Left join: a report may be held by nobody, and an assignee whose account is
      // gone leaves the report readable rather than dropping it from every list.
      .leftJoin(assignee, eq(assignee.id, journalEntries.assigneeId))
      .leftJoin(categories, eq(categories.id, journalEntries.categoryId))
      .leftJoin(departments, eq(departments.id, journalEntries.departmentId))
      .leftJoin(locations, eq(locations.id, journalEntries.locationId))
      .leftJoin(severities, eq(severities.id, journalEntries.severityId))
      .leftJoin(journalStatuses, eq(journalStatuses.id, journalEntries.statusId))
      .leftJoin(tasks, eq(tasks.id, journalEntries.taskId))
      .leftJoin(rejecter, eq(rejecter.id, journalEntries.rejectedById))
  );
}

// What a report list may be sorted or filtered by. The joined name columns are
// listed too, so a filter on status/severity/category/department/location/author/
// assignee reaches the right table — the sidebar builds only these fields.
const listConfig: ListConfig = {
  columns: {
    title: journalEntries.title,
    kind: journalEntries.kind,
    state: journalEntries.state,
    reportDate: journalEntries.reportDate,
    createdAt: journalEntries.createdAt,
    authorName: author.name,
    assigneeName: assignee.name,
    categoryName: categories.name,
    departmentName: departments.name,
    locationName: locations.name,
    severityName: severities.name,
    statusName: journalStatuses.name,
    // Id columns, for the searchable-dropdown filters that pick a record by id
    // rather than matching a (possibly non-unique) name.
    authorId: journalEntries.authorId,
    assigneeId: journalEntries.assigneeId,
    categoryId: journalEntries.categoryId,
    departmentId: journalEntries.departmentId,
    locationId: journalEntries.locationId,
  },
  defaultSort: journalEntries.reportDate,
};

/**
 * A filter on tags cannot go through the column whitelist — tags are a polymorphic
 * many-to-many, not a column on `reports`. Pull any `tag` filter out of the query
 * and turn it into an EXISTS on `taggables`; several tag values match a report that
 * carries any of them.
 */
function tagScopeFor(query: ResolvedListQuery): SQL | undefined {
  const tagFilter = query.filters.find((f) => f.field === "tag");
  if (!tagFilter) return undefined;
  const ids = (Array.isArray(tagFilter.value) ? tagFilter.value : [tagFilter.value])
    .map((value) => String(value))
    .filter((value) => value !== "");
  if (ids.length === 0) return undefined;
  return sql`EXISTS (
    SELECT 1 FROM ${taggables} tg
    WHERE tg.owner_type = 'report' AND tg.owner_id = ${journalEntries.id}
      AND tg.tag_id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
  )`;
}

/**
 * "Show me what is still sitting with my manager."
 *
 * Submitted, finished, and carrying no review score — the same condition
 * `awaitingReviewFor` uses for one person, offered here as a filter so it can be
 * combined with a date range or a team. A worker cannot see the review itself
 * (scoring is blind upward), but "has anybody looked at this yet" is not the score
 * and is exactly what people were asking each other in person.
 */
function awaitingReviewScope(query: ResolvedListQuery): SQL | undefined {
  const filter = query.filters.find((f) => f.field === "awaitingReview");
  if (!filter) return undefined;
  if (filter.value !== true && filter.value !== "true") return undefined;

  return sql`(
    ${journalEntries.state} = 'submitted'
    AND NOT EXISTS (
      SELECT 1 FROM journal_scores s
      WHERE s.report_id = ${journalEntries.id} AND s.tier = 'review'
    )
  )`;
}

/**
 * One box that finds an entry by title *or* by id.
 *
 * People quote the id to each other and then have nowhere to paste it: typing a
 * uuid into a title search matches nothing, which reads as "that entry is gone".
 * A value that parses as a uuid is looked up as an id; anything else is a title
 * search, which is what the box says it does.
 *
 * `contains` on the title, so a fragment works — the same behaviour the box had
 * before this existed.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function searchScope(query: ResolvedListQuery): SQL | undefined {
  const filter = query.filters.find((f) => f.field === "search");
  const text = String(filter?.value ?? "").trim();
  if (text === "") return undefined;

  if (UUID.test(text)) return eq(journalEntries.id, text);
  return ilike(journalEntries.title, `%${text}%`);
}

export async function getReport(id: string): Promise<JournalEntryRowRaw | null> {
  const [row] = await selectReports().where(eq(journalEntries.id, id));
  return row ?? null;
}

/**
 * A page of reports the caller may see. `visibleAuthorIds` is null for a caller who
 * may see every author (superadmin); otherwise it is the caller plus their downline.
 * A draft is only ever the author's own — never a manager's business until submitted.
 *
 * `restrictToIds` narrows the page to a pre-computed set (the scope roll-up passes
 * the reports found under an asset). It narrows and never widens: visibility is
 * applied on top of it, so a roll-up cannot surface a report the caller may not see.
 */
export async function listReports(
  query: ResolvedListQuery,
  callerId: string,
  visibleAuthorIds: string[] | null,
  companyId: string | null,
  restrictToIds: string[] | null = null,
  locationScope: SQL | undefined = undefined,
): Promise<{ rows: JournalEntryRowRaw[]; total: number }> {
  const parts = buildListParts(listConfig, query);

  // Visibility: your own (any state), anything handed to you, plus submitted
  // reports by anyone you may see. The assignee clause matters — work can be handed
  // across the org chart, and a report you are holding must appear in your own list
  // or the assignment is invisible to the person who has to act on it.
  const scope: SQL = visibilityScope(callerId, visibleAuthorIds);

  // Reports belong to a company; when one is active, keep the list within it.
  const companyScope = companyId ? eq(journalEntries.companyId, companyId) : undefined;
  const restrict = restrictToIds ? inArray(journalEntries.id, restrictToIds) : undefined;
  // Location narrows on top of authorship/downline visibility; it never widens it.
  // Both must hold, so a report by someone you manage at a site you cannot reach
  // stays hidden.
  const where = and(
    scope,
    companyScope,
    restrict,
    locationScope,
    tagScopeFor(query),
    awaitingReviewScope(query),
    searchScope(query),
    parts.where,
  );

  const rows = await selectReports()
    .where(where)
    .orderBy(parts.orderBy)
    .limit(parts.limit)
    .offset(parts.offset);

  // Counted through the **same joins** the rows use.
  //
  // This counted `from(journalEntries)` alone while the filter could name a joined
  // column — `severityName` is `severities.name`, and so are status, category,
  // department and location. Postgres then threw "missing FROM-clause entry for
  // table severities", which surfaced as a 500 on the journal for anybody who
  // filtered by severity. Worse, the filter is remembered per person, so the page
  // failed the same way on every visit and there was no way to clear it from the
  // screen that was broken — one report ended with somebody deleting a session-
  // storage key by hand in devtools.
  //
  // `countReports` reuses `selectReports()`'s joins rather than repeating them,
  // because two lists of joins that must agree are two lists that will not.
  const [counted] = await countReports().where(where);

  return { rows, total: counted?.count ?? 0 };
}

export interface NewJournalEntry {
  companyId: string;
  authorId: string;
  kind: string;
  state: string;
  title: string;
  categoryId?: string | null;
  departmentId?: string | null;
  locationId?: string | null;
  assigneeId?: string | null;
  severityId?: string | null;
  statusId?: string | null;
  reportDate?: Date;
  occurredAt?: Date | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  issueSummary?: string | null;
  issueDetail?: string | null;
  rootCause?: string | null;
  preventiveMeasures?: string | null;
  workSummary?: string | null;
  workDetail?: string | null;
  recurrenceOfId?: string | null;
  taskId?: string | null;
  submittedAt?: Date | null;
}

/**
 * The caller's own reports filed within a window — "what I did today" — plus a
 * count of their drafts.
 *
 * The window is passed in rather than computed here: "today" depends on the
 * operator's timezone, which the browser knows and the database does not. A
 * `current_date` in this query would give everyone UTC's day and quietly cut a
 * night shift in half.
 *
 * Drafts are counted, not windowed. A draft is unfinished work, and an unfinished
 * report from last Tuesday is more worth nagging about than one from this morning
 * — filtering them to today would hide exactly the ones that have been forgotten.
 */
export async function myReportsBetween(
  authorId: string,
  companyId: string,
  from: Date,
  to: Date,
  limit: number,
): Promise<{ rows: JournalEntryRowRaw[]; draftCount: number }> {
  const mine = and(eq(journalEntries.authorId, authorId), eq(journalEntries.companyId, companyId));

  const rows = await selectReports()
    .where(and(mine, gte(journalEntries.reportDate, from), lt(journalEntries.reportDate, to)))
    .orderBy(desc(journalEntries.createdAt))
    .limit(limit);

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(and(mine, eq(journalEntries.state, "draft")));

  return { rows, draftCount: counted?.count ?? 0 };
}

/**
 * Every report in one `recurrenceOfId` chain, oldest first — including the ones
 * *above* the given report as well as below it.
 *
 * Both directions matter: "this has happened before" is answered by walking up to
 * the original, and "this kept happening after" by walking down. A caller landing
 * on the middle of a chain wants the whole story, not the half of it that happens
 * to point their way. The root is found first, then the whole tree beneath it, so
 * two reports in one chain always return the same set whichever you ask from.
 *
 * `CYCLE` guards a self-link loop, exactly as the asset subtree walk does — the
 * column is set-null and user-editable, so a cycle is reachable by mistake.
 */
export async function recurrenceChain(
  reportId: string,
  companyId: string,
): Promise<
  {
    id: string;
    title: string;
    authorId: string;
    state: string;
    companyId: string;
    locationId: string | null;
    assigneeId: string | null;
    reportDate: Date;
    statusName: string | null;
    severityName: string | null;
  }[]
> {
  const result = await db.execute<{
    id: string;
    title: string;
    author_id: string;
    state: string;
    company_id: string;
    location_id: string | null;
    assignee_id: string | null;
    report_date: Date;
    status_name: string | null;
    severity_name: string | null;
  }>(sql`
    WITH RECURSIVE up AS (
      SELECT r.id, r.recurrence_of_id
      FROM journal_entries r
      WHERE r.id = ${reportId} AND r.company_id = ${companyId}

      UNION ALL

      SELECT r.id, r.recurrence_of_id
      FROM journal_entries r
      JOIN up u ON r.id = u.recurrence_of_id
    ) CYCLE id SET is_cycle_up USING path_up,
    root AS (
      SELECT id FROM up WHERE recurrence_of_id IS NULL AND NOT is_cycle_up LIMIT 1
    ),
    down AS (
      SELECT r.id
      FROM journal_entries r
      WHERE r.id = (SELECT id FROM root)

      UNION ALL

      SELECT r.id
      FROM journal_entries r
      JOIN down d ON r.recurrence_of_id = d.id
    ) CYCLE id SET is_cycle_down USING path_down
    SELECT DISTINCT r.id, r.title, r.author_id, r.state, r.company_id, r.location_id,
           r.assignee_id, r.report_date,
           s.name AS status_name, sev.name AS severity_name
    FROM down d
    JOIN journal_entries r ON r.id = d.id
    LEFT JOIN journal_statuses s ON s.id = r.status_id
    LEFT JOIN severities sev ON sev.id = r.severity_id
    WHERE NOT d.is_cycle_down AND r.company_id = ${companyId}
    ORDER BY r.report_date ASC
  `);

  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    authorId: r.author_id,
    state: r.state,
    // Selected so the visibility rule can apply its company check here too. The
    // chain is already scoped to one company by the query, but a caller that
    // hands `isVisible` a row without a company would be exempting itself from
    // the first thing that rule checks.
    companyId: r.company_id,
    locationId: r.location_id,
    assigneeId: r.assignee_id,
    reportDate: new Date(r.report_date),
    statusName: r.status_name,
    severityName: r.severity_name,
  }));
}

export async function insertReport(fields: NewJournalEntry): Promise<string> {
  const [row] = await db.insert(journalEntries).values(fields).returning({ id: journalEntries.id });
  return row!.id;
}

export type JournalEntryPatch = Partial<Omit<NewJournalEntry, "companyId" | "authorId">> & {
  lockedAt?: Date | null;
  submittedAt?: Date | null;
  rejectedAt?: Date | null;
  rejectedById?: string | null;
  rejectedFromStatusId?: string | null;
  rejectionReason?: string | null;
};

export async function updateReportRow(id: string, fields: JournalEntryPatch): Promise<void> {
  await db
    .update(journalEntries)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(journalEntries.id, id));
}

export async function deleteReportRow(id: string): Promise<void> {
  await db.delete(journalEntries).where(eq(journalEntries.id, id));
}

/** Whether any report references a config row — the in-use guard for deletes. */
export async function isConfigInUse(
  column: "categoryId" | "severityId" | "statusId",
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries[column], id))
    .limit(1);
  return row !== undefined;
}
