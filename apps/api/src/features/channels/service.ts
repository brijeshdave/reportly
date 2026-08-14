// Author: Brijesh Dave <https://github.com/brijeshdave>
// Contact-channel verification: issue a one-time code to a channel, then prove the
// person holds it by quoting the code back.
//
// The rules that make a short numeric code safe are all here: the code is random
// (not sequential), stored only as a hash, valid for minutes not days, burned
// after a handful of wrong guesses, and rate-limited on reissue. A channel with no
// provider configured is refused up front rather than silently dropped.
import { randomInt } from "node:crypto";
import { createHash, timingSafeEqual } from "node:crypto";

import {
  CHANNELS,
  CHANNEL_PROVIDERS,
  CHANNEL_VERIFICATION,
  type Channel,
  type ChannelCodeSent,
  type ChannelStatus,
  ERROR_CODES,
} from "@reportly/shared";

import { availability, ChannelSendError, sendVerificationCode } from "@/core/channels/senders.js";
import { AppError } from "@/core/errors.js";
import { getSystemSetting } from "@/core/settings/service.js";
import {
  type ChannelUserRow,
  consumeVerification,
  getChannelUser,
  insertVerification,
  latestVerification,
  markVerified,
  pendingVerification,
  recordAttempt,
} from "@/features/channels/repo.js";

/**
 * Where a channel points for this user. WhatsApp and Telegram ride on the mobile
 * number, and only when the user says the number is on them — an unflagged channel
 * has no address and cannot be verified.
 */
function destinationFor(user: ChannelUserRow, channel: Channel): string | null {
  switch (channel) {
    case "email":
      return user.email;
    case "mobile":
      return user.mobile;
    case "whatsapp":
      return user.whatsappOnMobile ? user.mobile : null;
    case "telegram":
      return user.telegramOnMobile ? user.mobile : null;
    case "discord":
      return user.discordHandle;
  }
}

function verifiedAtFor(user: ChannelUserRow, channel: Channel): Date | null {
  switch (channel) {
    // better-auth's email_verified is a boolean and records no time, so email
    // reports *that* it is verified without claiming to know when.
    case "email":
      return null;
    case "mobile":
      return user.mobileVerifiedAt;
    case "whatsapp":
      return user.whatsappVerifiedAt;
    case "telegram":
      return user.telegramVerifiedAt;
    case "discord":
      return user.discordVerifiedAt;
  }
}

function isVerified(user: ChannelUserRow, channel: Channel): boolean {
  if (channel === "email") return user.emailVerified;
  return verifiedAtFor(user, channel) !== null;
}

async function requireUser(userId: string): Promise<ChannelUserRow> {
  const user = await getChannelUser(userId);
  if (!user) throw new AppError(404, ERROR_CODES.NOT_FOUND, "User not found");
  return user;
}

/** Every channel for a user: where it points, whether it is proven, whether it can
 * even be used (a provider must be configured). */
export async function listChannels(userId: string): Promise<ChannelStatus[]> {
  const [user, providers] = await Promise.all([
    requireUser(userId),
    getSystemSetting(CHANNEL_PROVIDERS),
  ]);
  const canSend = availability(providers);

  return CHANNELS.map((channel) => {
    const verifiedAt = verifiedAtFor(user, channel);
    return {
      channel,
      destination: destinationFor(user, channel),
      verified: isVerified(user, channel),
      verifiedAt: verifiedAt ? verifiedAt.toISOString() : null,
      available: canSend[channel],
    };
  });
}

/** Hash, never store. A verification code is a bearer credential while it lives. */
function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Compare in constant time: a fast reject leaks how much of a guess was right. */
function codeMatches(code: string, expected: string): boolean {
  const a = Buffer.from(hash(code), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function generateCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i += 1) code += String(randomInt(0, 10));
  return code;
}

/**
 * Send a fresh code to a channel. Refuses when the channel has no address, is
 * already proven, has no configured provider, or was asked for again too soon.
 */
export async function requestCode(userId: string, channel: Channel): Promise<ChannelCodeSent> {
  const [user, providers, config] = await Promise.all([
    requireUser(userId),
    getSystemSetting(CHANNEL_PROVIDERS),
    getSystemSetting(CHANNEL_VERIFICATION),
  ]);

  if (isVerified(user, channel)) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, `Your ${channel} is already verified`);
  }

  const destination = destinationFor(user, channel);
  if (!destination) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Add ${channel === "discord" ? "a Discord handle" : "a mobile number"} first, and mark it as being on ${channel}.`,
    );
  }

  if (!availability(providers)[channel]) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `${channel} verification is not configured. An administrator must set its provider up in Settings.`,
    );
  }

  // Reissuing on demand would turn the attempt limit into a formality.
  const previous = await latestVerification(userId, channel);
  if (previous && config.resendCooldownSeconds > 0) {
    const readyAt = previous.createdAt.getTime() + config.resendCooldownSeconds * 1000;
    const waitSeconds = Math.ceil((readyAt - Date.now()) / 1000);
    if (waitSeconds > 0) {
      throw new AppError(
        429,
        ERROR_CODES.RATE_LIMITED,
        `A code was just sent. Try again in ${waitSeconds} seconds.`,
      );
    }
  }

  const code = generateCode(config.codeLength);
  const expiresAt = new Date(Date.now() + config.expiryMinutes * 60_000);
  await insertVerification({ userId, channel, destination, codeHash: hash(code), expiresAt });

  try {
    await sendVerificationCode(providers, channel, destination, code, config.expiryMinutes);
  } catch (err) {
    if (err instanceof ChannelSendError) {
      throw new AppError(502, ERROR_CODES.INTERNAL_ERROR, err.message);
    }
    throw err;
  }

  return { channel, expiresAt: expiresAt.toISOString() };
}

/**
 * Prove a channel with the code sent to it. A wrong guess costs an attempt; the
 * code is burned once they run out, so a 6-digit code cannot be walked through.
 */
export async function confirmCode(
  userId: string,
  channel: Channel,
  code: string,
): Promise<ChannelStatus[]> {
  const [user, config] = await Promise.all([
    requireUser(userId),
    getSystemSetting(CHANNEL_VERIFICATION),
  ]);

  const pending = await pendingVerification(userId, channel);
  if (!pending) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Ask for a code first");
  }
  if (pending.expiresAt.getTime() <= Date.now()) {
    await consumeVerification(pending.id);
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "That code has expired. Ask for a new one.",
    );
  }

  // The address may have changed since the code went out; proving the old one
  // would mark the new one verified.
  if (destinationFor(user, channel) !== pending.destination) {
    await consumeVerification(pending.id);
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Your ${channel} changed since that code was sent. Ask for a new one.`,
    );
  }

  if (!codeMatches(code, pending.codeHash)) {
    const attempts = pending.attempts + 1;
    if (attempts >= config.maxAttempts) {
      await consumeVerification(pending.id);
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Too many wrong codes. Ask for a new one.",
      );
    }
    await recordAttempt(pending.id, attempts);
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `That code is not right. ${config.maxAttempts - attempts} attempts left.`,
    );
  }

  await consumeVerification(pending.id);
  await markVerified(userId, channel, new Date());
  return listChannels(userId);
}
