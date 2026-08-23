// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reading the outbound message log.
//
// Read-only by design, like the audit repository: rows are written by the code
// that does the sending (`core/messages/record.ts`) and are never edited from a
// screen. A log somebody can tidy is not a log.
import type { ResolvedListQuery } from "@reportly/shared";
import { type SQL, and, eq, inArray, isNull, lt, not, or, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { outboundMessages, users } from "@/core/db/schema.js";
import { buildListParts, type ListConfig } from "@/lib/list-query.js";

export interface MessageRow {
  id: string;
  channel: string;
  kind: string;
  eventType: string | null;
  toUserId: string | null;
  toUserName: string | null;
  companyId: string | null;
  destination: string;
  subject: string | null;
  status: string;
  error: string | null;
  attempts: number;
  queuedAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const selection = {
  id: outboundMessages.id,
  channel: outboundMessages.channel,
  kind: outboundMessages.kind,
  eventType: outboundMessages.eventType,
  toUserId: outboundMessages.toUserId,
  toUserName: users.name,
  companyId: outboundMessages.companyId,
  destination: outboundMessages.destination,
  subject: outboundMessages.subject,
  status: outboundMessages.status,
  error: outboundMessages.error,
  attempts: outboundMessages.attempts,
  queuedAt: outboundMessages.queuedAt,
  sentAt: outboundMessages.sentAt,
  createdAt: outboundMessages.createdAt,
  updatedAt: outboundMessages.updatedAt,
};

const listConfig: ListConfig = {
  columns: {
    channel: outboundMessages.channel,
    kind: outboundMessages.kind,
    eventType: outboundMessages.eventType,
    toUserId: outboundMessages.toUserId,
    companyId: outboundMessages.companyId,
    status: outboundMessages.status,
    subject: outboundMessages.subject,
    queuedAt: outboundMessages.queuedAt,
  },
  defaultSort: outboundMessages.queuedAt,
};

/**
 * A tenant sees its own messages plus the ones belonging to no company.
 *
 * The same rule as the audit trail, for the same reason: a password reset has no
 * company, and hiding those behind whichever company happens to be selected would
 * make the log useless exactly when somebody is diagnosing a sign-in problem.
 * Superadmins pass null for no restriction.
 */
export function messageScope(companyId: string | null | undefined): SQL | undefined {
  if (!companyId) return undefined;
  return or(eq(outboundMessages.companyId, companyId), isNull(outboundMessages.companyId));
}

export async function listMessages(
  query: ResolvedListQuery,
  scope: SQL | undefined,
): Promise<{ rows: MessageRow[]; total: number }> {
  const parts = buildListParts(listConfig, query);
  const where = scope ? and(scope, parts.where) : parts.where;
  const rows = await db
    .select(selection)
    .from(outboundMessages)
    .leftJoin(users, eq(users.id, outboundMessages.toUserId))
    .where(where)
    .orderBy(parts.orderBy)
    .limit(parts.limit)
    .offset(parts.offset);
  const counted = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outboundMessages)
    .where(where);
  return { rows, total: counted[0]?.count ?? 0 };
}

/**
 * Drop rows older than the cutoff for one channel.
 *
 * Per channel because they are not worth the same: a bell-adjacent WhatsApp line
 * is noise after a week, while an email row carrying a provider's refusal is the
 * evidence somebody needs months later.
 *
 * `exceptTypes` are the kinds and notification types that carry their own number
 * and are swept separately — left alone here, or the channel's shorter clock would
 * quietly delete what an override was keeping.
 */
export async function pruneMessages(
  channel: string,
  cutoff: Date,
  exceptTypes: string[] = [],
): Promise<number> {
  const conditions = [eq(outboundMessages.channel, channel), lt(outboundMessages.queuedAt, cutoff)];
  if (exceptTypes.length > 0) conditions.push(not(inArray(typeKey(), exceptTypes)));

  const deleted = await db
    .delete(outboundMessages)
    .where(and(...conditions))
    .returning({ id: outboundMessages.id });
  return deleted.length;
}

/**
 * How a row names itself for retention: its kind, or `notification:<type>`.
 *
 * The same string the settings screen shows, so what an administrator types is
 * what the sweep matches — rather than two vocabularies that agree until they do
 * not.
 */
function typeKey() {
  return sql<string>`case when ${outboundMessages.kind} = 'notification'
      then 'notification:' || coalesce(${outboundMessages.eventType}, '')
      else ${outboundMessages.kind} end`;
}

/** Drop rows of one kind or notification type, on its own clock. */
export async function pruneMessagesOfType(type: string, cutoff: Date): Promise<number> {
  const deleted = await db
    .delete(outboundMessages)
    .where(and(eq(typeKey(), type), lt(outboundMessages.queuedAt, cutoff)))
    .returning({ id: outboundMessages.id });
  return deleted.length;
}
