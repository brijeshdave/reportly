// Author: Brijesh Dave <https://github.com/brijeshdave>
// Transactional email templates. Return subject/html/text; the caller supplies
// the recipient. Kept minimal and inline (no template engine dependency yet).
import type { OutgoingEmail } from "@/core/mail/mailer.js";

/**
 * Someone removed this account's second factor. The person is told unprompted,
 * and always: if they did not ask for it, this mail is how they find out that
 * somebody with administrative access took a lock off their account.
 */
export function twoFactorResetEmail(actorName: string): Omit<OutgoingEmail, "to"> {
  return {
    subject: "Two-factor authentication was removed from your Reportly account",
    text: `${actorName} removed two-factor authentication from your Reportly account. You have also been signed out everywhere.\n\nIf you asked for this — because you lost your authenticator or your recovery codes — sign in and set two-factor up again under Your account > Security.\n\nIf you did NOT ask for this, your account is protected by your password alone. Change it now and tell your administrator.`,
    html: `<p><strong>${actorName}</strong> removed two-factor authentication from your Reportly account. You have also been signed out everywhere.</p>
<p>If you asked for this — because you lost your authenticator or your recovery codes — sign in and set two-factor up again under <em>Your account &rsaquo; Security</em>.</p>
<p>If you did <strong>not</strong> ask for this, your account is protected by your password alone. Change it now, and tell your administrator.</p>`,
  };
}

/** A one-time code proving the recipient controls this address. */
export function verificationCodeEmail(
  code: string,
  expiryMinutes: number,
): Omit<OutgoingEmail, "to"> {
  return {
    subject: `${code} is your Reportly verification code`,
    text: `Your Reportly verification code is ${code}.\n\nIt expires in ${expiryMinutes} minutes.\n\nIf you didn't ask to verify this address, you can ignore this email.`,
    html: `<p>Your Reportly verification code is:</p>
<p style="font-size:24px;font-weight:600;letter-spacing:3px">${code}</p>
<p>It expires in ${expiryMinutes} minutes.</p>
<p>If you didn't ask to verify this address, you can safely ignore this email.</p>`,
  };
}

/** Escape text that came from a record's own fields before it goes in an HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A notification, as email.
 *
 * The title and body are assembled from things people typed — an asset name, a
 * comment, a department — so both are escaped. Nothing else on this page takes
 * user input into HTML, which is exactly why it would be missed: the CSV export
 * needed the same care and did not have it until SF-005.
 *
 * `link` arrives as a route and is turned into a URL here, since the mail is the
 * one place that leaves the browser and cannot resolve a relative path.
 */
export function notificationEmail(
  subject: string,
  body: string,
  url?: string,
): Omit<OutgoingEmail, "to"> {
  const link = url ? `\n\n${url}` : "";
  const linkHtml = url ? `<p><a href="${escapeHtml(url)}">Open it in Reportly</a></p>` : "";
  return {
    subject,
    text: `${subject}\n\n${body}${link}\n\nYou can change which notifications you receive under Your profile > Notifications.`,
    html: `<p><strong>${escapeHtml(subject)}</strong></p>
<p>${escapeHtml(body)}</p>
${linkHtml}
<p style="color:#6b7280;font-size:12px">You can change which notifications you receive under <em>Your profile &rsaquo; Notifications</em>.</p>`,
  };
}

export function resetPasswordEmail(resetUrl: string): Omit<OutgoingEmail, "to"> {
  return {
    subject: "Reset your Reportly password",
    text: `We received a request to reset your Reportly password.\n\nReset it here:\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>We received a request to reset your Reportly password.</p>
<p><a href="${resetUrl}">Reset your password</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
  };
}

/**
 * The invitation. Same link, different words.
 *
 * An invited person has no password to *re*set, and telling them to reset one
 * they have never had reads as a mistake — or as a phishing attempt, which is
 * worse. The mechanism underneath is better-auth's reset flow either way; only
 * this text knows the difference.
 */
export function inviteEmail(setUrl: string): Omit<OutgoingEmail, "to"> {
  return {
    subject: "You have been invited to Reportly",
    text: `You have been invited to Reportly.\n\nChoose your password to get started:\n${setUrl}\n\nIf you were not expecting this, you can ignore this email.`,
    html: `<p>You have been invited to Reportly.</p>
<p><a href="${setUrl}">Choose your password</a></p>
<p>If you were not expecting this, you can safely ignore this email.</p>`,
  };
}

/** The message a "send a test" button sends. Says what it is, and nothing else. */
export function testEmail(): Omit<OutgoingEmail, "to"> {
  return {
    subject: "Reportly test message",
    text: "This is a test message from Reportly. If you are reading it, email is configured correctly.",
    html: `<p>This is a test message from Reportly.</p>
<p>If you are reading it, email is configured correctly.</p>`,
  };
}
