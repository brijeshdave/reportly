// Author: Brijesh Dave <https://github.com/brijeshdave>
// The outside world for contact channels: the one module that talks to the
// providers delivering a verification code. Email goes through the app's own mail
// queue; SMS and WhatsApp through Twilio (or an API-compatible gateway); Telegram
// and Discord through their bot APIs.
//
// A channel whose provider is not configured is *unavailable*, not broken: the
// caller asks `availability()` first and the UI disables it, so nobody is told a
// code was sent when nothing left the building.
import type { Channel, ChannelProviders } from "@reportly/shared";

import { logger } from "@/core/logger.js";
import { notificationEmail, verificationCodeEmail } from "@/core/mail/templates.js";
import { enqueueEmail } from "@/core/queue/email.js";

/** Which channels can actually deliver, given the configured providers. */
export function availability(providers: ChannelProviders): Record<Channel, boolean> {
  const twilio = Boolean(providers.twilioAccountSid && providers.twilioAuthToken);
  return {
    // The mailer is part of the app, so email never needs configuring here.
    email: true,
    mobile: twilio && Boolean(providers.twilioSmsFrom),
    whatsapp: twilio && Boolean(providers.twilioWhatsappFrom),
    telegram: Boolean(providers.telegramBotToken),
    discord: Boolean(providers.discordBotToken),
  };
}

/** Raised when a provider rejects the send; the caller turns it into a 502. */
export class ChannelSendError extends Error {
  constructor(
    readonly channel: Channel,
    message: string,
  ) {
    super(message);
    this.name = "ChannelSendError";
  }
}

const BODY = (code: string, minutes: number) =>
  `Your Reportly verification code is ${code}. It expires in ${minutes} minutes.`;

/**
 * Twilio's messaging endpoint serves both SMS and WhatsApp; only the `From`
 * differs (WhatsApp addresses are prefixed `whatsapp:`).
 */
async function sendTwilio(
  providers: ChannelProviders,
  channel: Channel,
  from: string,
  to: string,
  body: string,
): Promise<void> {
  const auth = Buffer.from(`${providers.twilioAccountSid}:${providers.twilioAuthToken}`).toString(
    "base64",
  );
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${providers.twilioAccountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: to, Body: body }),
    },
  );
  if (!response.ok) {
    throw new ChannelSendError(channel, `Twilio refused the message (${response.status})`);
  }
}

async function sendTelegram(providers: ChannelProviders, to: string, body: string): Promise<void> {
  // Telegram bots address a chat id, not a phone number. A person must have
  // started a chat with the bot first — the app cannot message a stranger.
  const response = await fetch(
    `https://api.telegram.org/bot${providers.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: to, text: body }),
    },
  );
  if (!response.ok) {
    throw new ChannelSendError(
      "telegram",
      `Telegram refused the message (${response.status}). The user must have started a chat with the bot.`,
    );
  }
}

async function sendDiscord(providers: ChannelProviders, to: string, body: string): Promise<void> {
  // A DM needs a channel opened against the recipient's Discord user id first.
  const headers = {
    Authorization: `Bot ${providers.discordBotToken}`,
    "Content-Type": "application/json",
  };
  const dm = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: to }),
  });
  if (!dm.ok) {
    throw new ChannelSendError(
      "discord",
      `Discord would not open a DM (${dm.status}). The handle must be a Discord user id the bot shares a server with.`,
    );
  }
  const channelId = ((await dm.json()) as { id?: string }).id;
  if (!channelId) throw new ChannelSendError("discord", "Discord returned no DM channel");

  const sent = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: body }),
  });
  if (!sent.ok) {
    throw new ChannelSendError("discord", `Discord refused the message (${sent.status})`);
  }
}

/**
 * Deliver `code` to `destination` over `channel`. The code is never logged — it is
 * a credential for as long as it lives.
 */
export async function sendVerificationCode(
  providers: ChannelProviders,
  channel: Channel,
  destination: string,
  code: string,
  expiryMinutes: number,
): Promise<void> {
  const body = BODY(code, expiryMinutes);
  logger.info({ channel }, "Sending a channel verification code");

  switch (channel) {
    case "email":
      await enqueueEmail({ to: destination, ...verificationCodeEmail(code, expiryMinutes) });
      return;
    case "mobile":
      await sendTwilio(providers, "mobile", providers.twilioSmsFrom, destination, body);
      return;
    case "whatsapp":
      await sendTwilio(
        providers,
        "whatsapp",
        providers.twilioWhatsappFrom,
        `whatsapp:${destination}`,
        body,
      );
      return;
    case "telegram":
      await sendTelegram(providers, destination, body);
      return;
    case "discord":
      await sendDiscord(providers, destination, body);
      return;
  }
}

/**
 * Deliver an arbitrary message over a channel — what notifications send on.
 *
 * The same switch as the verification code, over a subject and a body instead of
 * a credential. Kept as a separate entry point rather than generalising the one
 * above, because the code path must never grow a caller that logs its argument:
 * a notification body is ordinary text and is logged freely, a verification code
 * is not, and one function taking both invites exactly that mistake.
 *
 * The messaging channels get `subject — body` on one line. They have no subject
 * field, and a bare body loses what the message was about.
 */
export async function sendToChannel(
  providers: ChannelProviders,
  channel: Channel,
  destination: string,
  subject: string,
  body: string,
  url?: string,
): Promise<void> {
  const line = body ? `${subject} — ${body}` : subject;

  switch (channel) {
    case "email":
      await enqueueEmail({ to: destination, ...notificationEmail(subject, body, url) });
      return;
    case "mobile":
      await sendTwilio(providers, "mobile", providers.twilioSmsFrom, destination, line);
      return;
    case "whatsapp":
      await sendTwilio(
        providers,
        "whatsapp",
        providers.twilioWhatsappFrom,
        `whatsapp:${destination}`,
        line,
      );
      return;
    case "telegram":
      await sendTelegram(providers, destination, line);
      return;
    case "discord":
      await sendDiscord(providers, destination, line);
      return;
  }
}
