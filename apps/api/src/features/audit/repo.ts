// Author: Brijesh Dave <https://github.com/brijeshdave>
// Audit + history repository. Rows are append-only: this module exposes no update
// or delete path, which is what makes the audit trail immutable.
import type { ResolvedListQuery } from "@reportly/shared";
import { type SQL, and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { auditEvents, entityHistory, users } from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";

export interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  companyId: string | null;
  ip: string | null;
  requestId: string | null;
  details: unknown;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

/** Columns selected for an audit row, with the actor resolved to a user. */
const auditSelection = {
  id: auditEvents.id,
  action: auditEvents.action,
  actorId: auditEvents.actorId,
  actorName: users.name,
  actorEmail: users.email,
  companyId: auditEvents.companyId,
  ip: auditEvents.ip,
  requestId: auditEvents.requestId,
  details: auditEvents.details,
  before: auditEvents.before,
  after: auditEvents.after,
  createdAt: auditEvents.createdAt,
};

export interface HistoryRow {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  actorId: string | null;
  createdAt: Date;
}

const auditListConfig: ListConfig = {
  columns: {
    action: auditEvents.action,
    actorId: auditEvents.actorId,
    companyId: auditEvents.companyId,
    requestId: auditEvents.requestId,
    createdAt: auditEvents.createdAt,
  },
  defaultSort: auditEvents.createdAt,
};

/**
 * Non-superadmins only see events for their active company (plus system events,
 * which have no company). Superadmins pass `null` for no restriction.
 */
export function auditScope(companyId: string | null | undefined): SQL | undefined {
  if (!companyId) return undefined;
  return or(eq(auditEvents.companyId, companyId), isNull(auditEvents.companyId));
}

export async function listAuditEvents(
  query: ResolvedListQuery,
  scope: SQL | undefined,
): Promise<{ rows: AuditRow[]; total: number }> {
  const parts = buildListParts(auditListConfig, query);
  const where = scope ? and(scope, parts.where) : parts.where;
  // Resolve the actor to a user in the same query — a join on the users PK, so it
  // stays cheap. A system action (actorId null) or a since-deleted user leaves the
  // name null, which the UI shows as "system"/the raw id.
  const rows = await db
    .select(auditSelection)
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(where)
    .orderBy(parts.orderBy)
    .limit(parts.limit)
    .offset(parts.offset);
  const counted = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(where);
  return { rows, total: counted[0]?.count ?? 0 };
}

/**
 * Every action that actually appears in the trail.
 *
 * Built from the rows rather than from a hand-kept list, because audit actions are
 * written as free strings by each feature — a catalogue would drift the first time
 * somebody added one. Distinct over an indexed column, and small: an installation
 * has dozens of action names, not thousands.
 */
export async function distinctActions(scope: SQL | undefined): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditEvents.action })
    .from(auditEvents)
    .where(scope)
    .orderBy(asc(auditEvents.action));
  return rows.map((row) => row.action);
}

/** Stream audit rows in batches so a large export never loads everything at once. */
export async function* streamAuditEvents(
  scope: SQL | undefined,
  batchSize = 500,
): AsyncGenerator<AuditRow[]> {
  for (let offset = 0; ; offset += batchSize) {
    const rows = await db
      .select(auditSelection)
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(scope)
      .orderBy(desc(auditEvents.createdAt))
      .limit(batchSize)
      .offset(offset);
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < batchSize) return;
  }
}

export async function listEntityHistory(
  entityType: string,
  entityId: string,
  query: ResolvedListQuery,
): Promise<{ rows: HistoryRow[]; total: number }> {
  const where = and(eq(entityHistory.entityType, entityType), eq(entityHistory.entityId, entityId));
  const order =
    query.sortDir === "asc" ? asc(entityHistory.createdAt) : desc(entityHistory.createdAt);
  const rows = await db
    .select()
    .from(entityHistory)
    .where(where)
    .orderBy(order)
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const counted = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entityHistory)
    .where(where);
  return { rows, total: counted[0]?.count ?? 0 };
}
