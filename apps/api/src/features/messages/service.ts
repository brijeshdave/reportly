// Author: Brijesh Dave <https://github.com/brijeshdave>
// The outbound message log, as a screen reads it.
import {
  type OutboundMessage,
  type PaginatedResult,
  type ResolvedListQuery,
  messageChannelSchema,
  messageKindSchema,
  messageStatusSchema,
  toPaginatedResult,
} from "@reportly/shared";

import { listMessages, type MessageRow } from "@/features/messages/repo.js";
import type { SQL } from "drizzle-orm";

/**
 * The stored strings are widened back to their unions here.
 *
 * A row written by an older version — a kind since renamed — would otherwise fail
 * the response schema and take the whole screen down with it. The log is the last
 * thing that should break while somebody is diagnosing a problem, so an
 * unrecognised value is reported as-is rather than thrown over.
 */
function serialize(row: MessageRow): OutboundMessage {
  return {
    id: row.id,
    channel: messageChannelSchema.catch("email").parse(row.channel),
    kind: messageKindSchema.catch("notification").parse(row.kind),
    eventType: row.eventType,
    toUserId: row.toUserId,
    toUserName: row.toUserName,
    companyId: row.companyId,
    destination: row.destination,
    subject: row.subject,
    status: messageStatusSchema.catch("queued").parse(row.status),
    error: row.error,
    attempts: row.attempts,
    queuedAt: row.queuedAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getMessages(
  query: ResolvedListQuery,
  scope: SQL | undefined,
): Promise<PaginatedResult<OutboundMessage>> {
  const { rows, total } = await listMessages(query, scope);
  return toPaginatedResult(rows.map(serialize), total, query);
}
