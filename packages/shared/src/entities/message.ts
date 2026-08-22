// Author: Brijesh Dave <https://github.com/brijeshdave>
// Outbound messages: the record of what Reportly sent, to which channel, and
// whether it arrived.
//
// Until this existed, every email went through the queue to nodemailer and
// **nothing survived the job**. Whether a password reset reached somebody was
// answerable only by asking them — and when a provider refused a message, the
// refusal reached a log nobody was reading. That is how an installation spent a
// week believing it was sending mail while Resend rejected every message.
//
// What is deliberately NOT here: the body. A reset email contains a working reset
// link, and a log that keeps it is a second front door with a longer memory than
// the token itself. The kind and the subject say enough to support somebody.
import { z } from "zod";

import { timestampsSchema, uuidSchema } from "@/entities/common.js";

/** Where a message went. `inapp` is not here: the bell has its own table. */
export const MESSAGE_CHANNELS = ["email", "mobile", "whatsapp", "telegram", "discord"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export const messageChannelSchema = z.enum(MESSAGE_CHANNELS);

/**
 * What the message *was*, so a class of them can be found.
 *
 * `notification` covers every event from the notification catalogue — the type
 * itself is kept alongside, so "every downtime alert we sent on WhatsApp" is one
 * query rather than a guess from subject lines.
 */
export const MESSAGE_KINDS = [
  "password-reset",
  "invite",
  "two-factor-reset",
  "verification-code",
  "notification",
  "test",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export const messageKindSchema = z.enum(MESSAGE_KINDS);

export const MESSAGE_STATUSES = ["queued", "sent", "failed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const messageStatusSchema = z.enum(MESSAGE_STATUSES);

export const outboundMessageSchema = z
  .object({
    id: uuidSchema,
    channel: messageChannelSchema,
    kind: messageKindSchema,
    /** The notification type, when `kind` is `notification`. */
    eventType: z.string().nullable(),
    /** Who it was for, when it was somebody in the system. */
    toUserId: uuidSchema.nullable(),
    toUserName: z.string().nullable(),
    /** Null when the message is about the installation rather than one company. */
    companyId: uuidSchema.nullable(),
    /** Redacted at the point of writing: `b•••@example.com`, `+91•••4321`. */
    destination: z.string(),
    subject: z.string().nullable(),
    status: messageStatusSchema,
    /** The provider's own refusal, kept verbatim. The reason an API beats SMTP. */
    error: z.string().nullable(),
    attempts: z.number().int(),
    queuedAt: z.string(),
    sentAt: z.string().nullable(),
  })
  .extend(timestampsSchema.shape);
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

/**
 * Enough of a destination to recognise, not enough to harvest.
 *
 * A support question is "did it go to the right address?", which the first
 * character and the domain answer. A full list of everybody's address and phone
 * number, readable by anybody who can open the log screen, answers a different
 * question that nobody asked.
 */
export function redactDestination(destination: string): string {
  const value = destination.trim();
  if (value === "") return "";

  const at = value.lastIndexOf("@");
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at);
    return `${local[0]}•••${domain}`;
  }

  // A phone number, a Telegram chat id, a Discord handle: keep the last four, so
  // somebody can confirm it is the number they expect.
  if (value.length <= 4) return "•••";
  return `${value.slice(0, Math.min(3, value.length - 4))}•••${value.slice(-4)}`;
}
