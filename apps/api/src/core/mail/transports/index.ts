// Author: Brijesh Dave <https://github.com/brijeshdave>
// Choosing how email leaves the building.
//
// SMTP is the default and unchanged. The API transports exist because SMTP cannot
// tell you why it refused you until far too late — a relay accepts the connection,
// accepts the message, and the rejection lands somewhere the app never sees. An
// HTTP API answers in the same breath, and that answer reaches the message log and
// the person who pressed "send a test".
//
// One module per provider, one plain POST each, chosen once at boot.
import { env } from "@/core/env.js";
import type { OutgoingEmail } from "@/core/mail/message.js";
import { postToProvider } from "@/core/mail/transports/http.js";

export type SendFn = (message: OutgoingEmail) => Promise<void>;

/** `Name <address>` or a bare address — providers want the parts separately. */
function fromParts(): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(env.MAIL_FROM);
  if (!match) return { email: env.MAIL_FROM.trim() };
  return { email: match[2]!.trim(), name: match[1] || undefined };
}

const resend: SendFn = async (message) => {
  const from = fromParts();
  await postToProvider("Resend", {
    url: "https://api.resend.com/emails",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: {
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    },
  });
};

const sendgrid: SendFn = async (message) => {
  const from = fromParts();
  await postToProvider("SendGrid", {
    url: "https://api.sendgrid.com/v3/mail/send",
    headers: { authorization: `Bearer ${env.SENDGRID_API_KEY}` },
    body: {
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: from.email, ...(from.name ? { name: from.name } : {}) },
      subject: message.subject,
      content: [
        // Order matters to SendGrid: text/plain must come first.
        { type: "text/plain", value: message.text },
        { type: "text/html", value: message.html },
      ],
    },
  });
};

const postmark: SendFn = async (message) => {
  const from = fromParts();
  await postToProvider("Postmark", {
    url: "https://api.postmarkapp.com/email",
    headers: { "x-postmark-server-token": env.POSTMARK_TOKEN ?? "", accept: "application/json" },
    body: {
      From: from.name ? `${from.name} <${from.email}>` : from.email,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
    },
  });
};

/** The API transports, by the name `MAIL_TRANSPORT` uses. SMTP lives in mailer.ts. */
export const API_TRANSPORTS: Record<string, SendFn> = { resend, sendgrid, postmark };
