// Author: Brijesh Dave <https://github.com/brijeshdave>
// Log repository (reads the separate log database). Rows are append-only: no
// update or delete path here — pruning happens via the retention sweep.
import type { ResolvedListQuery } from "@reportly/shared";
import { type SQL, and, asc, desc, sql } from "drizzle-orm";

import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";

export interface LogRecord {
  id: string;
  ts: Date;
  level: string;
  feature: string;
  requestId: string | null;
  userId: string | null;
  companyId: string | null;
  msg: string;
  context: unknown;
}

export interface LogCursor {
  ts: Date;
  id: string;
}

const listConfig: ListConfig = {
  columns: {
    level: appLogs.level,
    feature: appLogs.feature,
    requestId: appLogs.requestId,
    userId: appLogs.userId,
    companyId: appLogs.companyId,
    msg: appLogs.msg,
    ts: appLogs.ts,
  },
  defaultSort: appLogs.ts,
};

export async function listLogs(
  query: ResolvedListQuery,
): Promise<{ rows: LogRecord[]; total: number }> {
  const { where, orderBy, limit, offset } = buildListParts(listConfig, query);
  const rows = await logDb
    .select()
    .from(appLogs)
    .where(where)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);
  const counted = await logDb
    .select({ count: sql<number>`count(*)::int` })
    .from(appLogs)
    .where(where);
  return { rows, total: counted[0]?.count ?? 0 };
}

/**
 * Live tail. With no cursor, returns the newest `limit` rows (oldest first) so a
 * viewer can render them in order. With a cursor, returns only rows strictly after
 * it, compared on `(ts, id)` so rows sharing a timestamp are never skipped.
 */
export async function tailLogs(cursor: LogCursor | null, limit: number): Promise<LogRecord[]> {
  if (!cursor) {
    const newest = await logDb
      .select()
      .from(appLogs)
      .orderBy(desc(appLogs.ts), desc(appLogs.id))
      .limit(limit);
    return newest.reverse();
  }
  return logDb
    .select()
    .from(appLogs)
    .where(sql`(${appLogs.ts}, ${appLogs.id}) > (${cursor.ts}, ${cursor.id}::uuid)`)
    .orderBy(asc(appLogs.ts), asc(appLogs.id))
    .limit(limit);
}

/** Stream log rows in batches so a large export never loads everything at once. */
export async function* streamLogs(
  where: SQL | undefined,
  batchSize = 500,
): AsyncGenerator<LogRecord[]> {
  for (let offset = 0; ; offset += batchSize) {
    const rows = await logDb
      .select()
      .from(appLogs)
      .where(where)
      .orderBy(desc(appLogs.ts))
      .limit(batchSize)
      .offset(offset);
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < batchSize) return;
  }
}

/** Build the same WHERE the list endpoint uses, for exports. */
export function logFilterWhere(query: ResolvedListQuery): SQL | undefined {
  const { where } = buildListParts(listConfig, query);
  return where ? and(where) : undefined;
}
