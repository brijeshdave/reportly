// Author: Brijesh Dave <https://github.com/brijeshdave>
// SMTP transport (dev: Mailpit) and the low-level send. Emails are enqueued via
// BullMQ and delivered here by the email worker — routes never send inline.
import nodemailer from "nodemailer";

import { env } from "@/core/env.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

export async function sendEmail(message: OutgoingEmail): Promise<void> {
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}

/**
 * Opens a connection to the relay and authenticates, without sending anything.
 * Used by `cli doctor`: a misconfigured relay is invisible until the first
 * invitation, because sends are queued — so the mail failure surfaces hours
 * later, as a person who never got their email, rather than at deploy time.
 */
export async function verifyMailer(): Promise<void> {
  await transport.verify();
}
