// Author: Brijesh Dave <https://github.com/brijeshdave>
// Log read logic: serialization, opaque tail cursors, and streamed exports.
import { Readable } from "node:stream";

import { type ResolvedListQuery, type PaginatedResult, toPaginatedResult } from "@reportly/shared";
import { csvCell } from "@/lib/csv.js";

import {
  type LogCursor,
  type LogRecord,
  listLogs,
  logFilterWhere,
  streamLogs,
  tailLogs,
} from "@/features/logs/repo.js";

export interface LogEntry {
  id: string;
  ts: string;
  level: string;
  feature: string;
  requestId: string | null;
  userId: string | null;
  companyId: string | null;
  msg: string;
  context: unknown;
}

function serialize(row: LogRecord): LogEntry {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    level: row.level,
    feature: row.feature,
    requestId: row.requestId,
    userId: row.userId,
    companyId: row.companyId,
    msg: row.msg,
    context: row.context ?? null,
  };
}

/** Cursors are opaque to clients: base64url of `<iso timestamp>|<row id>`. */
export function encodeCursor(row: LogRecord): string {
  return Buffer.from(`${row.ts.toISOString()}|${row.id}`).toString("base64url");
}

export function decodeCursor(cursor: string): LogCursor | null {
  try {
    const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!ts || !id) return null;
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? null : { ts: date, id };
  } catch {
    return null;
  }
}

export async function getLogs(query: ResolvedListQuery): Promise<PaginatedResult<LogEntry>> {
  const { rows, total } = await listLogs(query);
  return toPaginatedResult(rows.map(serialize), total, query);
}

export async function getLogTail(
  cursor: string | undefined,
  limit: number,
): Promise<{ entries: LogEntry[]; nextCursor: string | null }> {
  const decoded = cursor ? decodeCursor(cursor) : null;
  const rows = await tailLogs(decoded, limit);
  return {
    entries: rows.map(serialize),
    // Keep the previous cursor when nothing new arrived, so polling stays put.
    nextCursor: rows.length > 0 ? encodeCursor(rows[rows.length - 1]!) : (cursor ?? null),
  };
}

const CSV_COLUMNS = ["id", "ts", "level", "feature", "requestId", "userId", "msg"] as const;

export function exportLogs(query: ResolvedListQuery, format: "csv" | "json"): Readable {
  const where = logFilterWhere(query);
  return Readable.from(
    (async function* () {
      if (format === "csv") yield `${CSV_COLUMNS.join(",")}\n`;
      for await (const batch of streamLogs(where)) {
        for (const row of batch) {
          const entry = serialize(row);
          yield format === "csv"
            ? `${CSV_COLUMNS.map((c) => csvCell(entry[c])).join(",")}\n`
            : `${JSON.stringify(entry)}\n`;
        }
      }
    })(),
  );
}
