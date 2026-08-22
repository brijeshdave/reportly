// Author: Brijesh Dave <https://github.com/brijeshdave>
// Writing the outbound message log.
//
// Called by the two places every outbound message actually passes through — the
// email worker and the channel senders — and never by the code that *asks* for a
// message to be sent. Recording at the call sites would mean the next feature to
// send an email quietly sends an unrecorded one, which is the state this table
// was added to end.
//
// Nothing here may throw into the sending path. A log that can stop a password
// reset going out is worse than no log: the failure it introduces is bigger than
// the one it reports.
import {
  MESSAGE_RETENTION,
  type MessageChannel,
  type MessageKind,
  redactDestination,
} from "@reportly/shared";
import { eq, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { outboundMessages } from "@/core/db/schema.js";
import { logger } from "@/core/logger.js";
import { getSystemSetting } from "@/core/settings/service.js";

export interface MessageRecord {
  channel: MessageChannel;
  kind: MessageKind;
  /** The notification type, when the kind is `notification`. */
  eventType?: string | null;
  toUserId?: string | null;
  /** Null for a message about the installation rather than one company. */
  companyId?: string | null;
  /** The real destination. Redacted here — callers do not have to remember to. */
  destination: string;
  subject?: string | null;
}

/**
 * Note that a message is on its way. Returns the row id, or null if it could not.
 *
 * A channel whose retention is 0 is not logged at all — the setting is "keep this
 * for N days", and keeping something for no days by writing it and deleting it
 * later is a worse answer than not writing it. That also gives an installation a
 * way to hold no record of, say, SMS at all.
 */
export async function recordQueued(message: MessageRecord): Promise<string | null> {
  try {
    const retention = await getSystemSetting(MESSAGE_RETENTION);
    if (retention[message.channel] === 0) return null;
  } catch {
    // Unreadable settings must not stop a message being recorded: default to
    // keeping it, which is the recoverable mistake of the two.
  }

  try {
    const [row] = await db
      .insert(outboundMessages)
      .values({
        channel: message.channel,
        kind: message.kind,
        eventType: message.eventType ?? null,
        toUserId: message.toUserId ?? null,
        companyId: message.companyId ?? null,
        destination: redactDestination(message.destination),
        subject: message.subject ?? null,
        status: "queued",
      })
      .returning({ id: outboundMessages.id });
    return row?.id ?? null;
  } catch (error) {
    logger.warn({ err: error, channel: message.channel }, "Could not record an outbound message");
    return null;
  }
}

/** It went. */
export async function markSent(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await db
      .update(outboundMessages)
      .set({
        status: "sent",
        sentAt: new Date(),
        error: null,
        attempts: sql`${outboundMessages.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(outboundMessages.id, id));
  } catch (error) {
    logger.warn({ err: error, id }, "Could not mark an outbound message sent");
  }
}

/**
 * It did not go, and here is what the provider said.
 *
 * The provider's own words, kept whole and untranslated. "API key not authorized
 * for this domain: example.com" is the entire diagnosis; a tidied "delivery
 * failed" would have cost days.
 */
export async function markFailed(id: string | null, error: unknown): Promise<void> {
  if (!id) return;
  const message = error instanceof Error ? error.message : String(error);
  try {
    await db
      .update(outboundMessages)
      .set({
        status: "failed",
        error: message.slice(0, 2000),
        attempts: sql`${outboundMessages.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(outboundMessages.id, id));
  } catch (dbError) {
    logger.warn({ err: dbError, id }, "Could not mark an outbound message failed");
  }
}
