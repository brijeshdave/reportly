// Author: Brijesh Dave <https://github.com/brijeshdave>
// Audit + history business logic: serialization to the shared contracts and
// streaming exports that never materialise the whole result set in memory.
import { Readable } from "node:stream";

import {
  type AuditEvent,
  type EntityHistory,
  type ResolvedListQuery,
  type PaginatedResult,
  toPaginatedResult,
} from "@reportly/shared";
import type { SQL } from "drizzle-orm";
import { csvCell } from "@/lib/csv.js";

import {
  type AuditRow,
  type HistoryRow,
  listAuditEvents,
  listEntityHistory,
  streamAuditEvents,
} from "@/features/audit/repo.js";

function serializeAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    companyId: row.companyId,
    ip: row.ip,
    requestId: row.requestId,
    details: row.details ?? null,
    before: row.before ?? null,
    after: row.after ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeHistory(row: HistoryRow): EntityHistory {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    field: row.field,
    oldValue: row.oldValue ?? null,
    newValue: row.newValue ?? null,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getAuditEvents(
  query: ResolvedListQuery,
  scope: SQL | undefined,
): Promise<PaginatedResult<AuditEvent>> {
  const { rows, total } = await listAuditEvents(query, scope);
  return toPaginatedResult(rows.map(serializeAudit), total, query);
}

export async function getEntityHistory(
  entityType: string,
  entityId: string,
  query: ResolvedListQuery,
): Promise<PaginatedResult<EntityHistory>> {
  const { rows, total } = await listEntityHistory(entityType, entityId, query);
  return toPaginatedResult(rows.map(serializeHistory), total, query);
}

const CSV_COLUMNS = [
  "id",
  "createdAt",
  "action",
  "actorId",
  "actorName",
  "actorEmail",
  "companyId",
  "ip",
  "requestId",
] as const;

/** Stream the audit trail as CSV or newline-delimited JSON, batch by batch. */
export function exportAuditEvents(scope: SQL | undefined, format: "csv" | "json"): Readable {
  return Readable.from(
    (async function* () {
      if (format === "csv") yield `${CSV_COLUMNS.join(",")}\n`;
      for await (const batch of streamAuditEvents(scope)) {
        for (const row of batch) {
          const event = serializeAudit(row);
          yield format === "csv"
            ? `${CSV_COLUMNS.map((c) => csvCell(event[c])).join(",")}\n`
            : `${JSON.stringify(event)}\n`;
        }
      }
    })(),
  );
}
