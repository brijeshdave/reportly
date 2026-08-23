// Author: Brijesh Dave <https://github.com/brijeshdave>
// How email actually leaves: SMTP (dev: Mailpit), or a provider's HTTP API.
// Emails are enqueued via BullMQ and delivered here by the email worker — routes
// never send inline.
//
// The transport is chosen once, from MAIL_TRANSPORT, and nothing else in the app
// learns which is in use. Boot refuses a transport whose credential is missing
// rather than falling back to SMTP: an installation that believes it is sending
// through Resend while posting to localhost:1025 is the quiet non-delivery this
// whole area exists to end.
import nodemailer from "nodemailer";

import { env } from "@/core/env.js";
import { API_TRANSPORTS } from "@/core/mail/transports/index.js";

export type { OutgoingEmail } from "@/core/mail/message.js";
import type { OutgoingEmail } from "@/core/mail/message.js";

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const api = API_TRANSPORTS[env.MAIL_TRANSPORT];
  if (api) {
    await api(message);
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}

/**
 * Opens a connection to the relay and authenticates, without sending anything.
 * Used by `cli doctor`: a misconfigured relay is invisible until the first
 * invitation, because sends are queued — so the mail failure surfaces hours
 * later, as a person who never got their email, rather than at deploy time.
 */
export async function verifyMailer(): Promise<void> {
  // Nothing to open when a provider's API is in use: there is no connection to
  // hold, and pretending to verify one would be a check that always passed.
  // Settings → Channels → Send a test message is the check that means something
  // for those — and, as it turns out, for SMTP too.
  if (API_TRANSPORTS[env.MAIL_TRANSPORT]) return;
  await transport.verify();
}
