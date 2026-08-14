// Author: Brijesh Dave <https://github.com/brijeshdave>
// Channel-verification repository — the only code touching channel_verifications,
// and the only writer of the users table's per-channel verified-at columns.
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { channelVerifications, users } from "@/core/db/schema.js";
import type { Channel } from "@reportly/shared";

export interface VerificationRow {
  id: string;
  userId: string;
  channel: string;
  destination: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

/** Everything the channel view needs about a user, in one read. */
export interface ChannelUserRow {
  id: string;
  email: string;
  emailVerified: boolean;
  mobile: string | null;
  whatsappOnMobile: boolean;
  telegramOnMobile: boolean;
  discordHandle: string | null;
  mobileVerifiedAt: Date | null;
  whatsappVerifiedAt: Date | null;
  telegramVerifiedAt: Date | null;
  discordVerifiedAt: Date | null;
}

export async function getChannelUser(userId: string): Promise<ChannelUserRow | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      mobile: users.mobile,
      whatsappOnMobile: users.whatsappOnMobile,
      telegramOnMobile: users.telegramOnMobile,
      discordHandle: users.discordHandle,
      mobileVerifiedAt: users.mobileVerifiedAt,
      whatsappVerifiedAt: users.whatsappVerifiedAt,
      telegramVerifiedAt: users.telegramVerifiedAt,
      discordVerifiedAt: users.discordVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/** The newest code issued for this channel, spent or not — the cooldown reads it. */
export async function latestVerification(
  userId: string,
  channel: Channel,
): Promise<VerificationRow | null> {
  const [row] = await db
    .select()
    .from(channelVerifications)
    .where(and(eq(channelVerifications.userId, userId), eq(channelVerifications.channel, channel)))
    .orderBy(desc(channelVerifications.createdAt))
    .limit(1);
  return row ?? null;
}

/** The live (unspent) code for this channel, if there is one. */
export async function pendingVerification(
  userId: string,
  channel: Channel,
): Promise<VerificationRow | null> {
  const [row] = await db
    .select()
    .from(channelVerifications)
    .where(
      and(
        eq(channelVerifications.userId, userId),
        eq(channelVerifications.channel, channel),
        isNull(channelVerifications.consumedAt),
      ),
    )
    .orderBy(desc(channelVerifications.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Issue a code, spending any earlier one for the channel first: two live codes for
 * one channel would double the guesses an attacker gets per attempt budget.
 */
export async function insertVerification(fields: {
  userId: string;
  channel: Channel;
  destination: string;
  codeHash: string;
  expiresAt: Date;
}): Promise<VerificationRow> {
  return db.transaction(async (tx) => {
    await tx
      .update(channelVerifications)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(channelVerifications.userId, fields.userId),
          eq(channelVerifications.channel, fields.channel),
          isNull(channelVerifications.consumedAt),
        ),
      );
    const [row] = await tx.insert(channelVerifications).values(fields).returning();
    return row!;
  });
}

export async function recordAttempt(id: string, attempts: number): Promise<void> {
  await db.update(channelVerifications).set({ attempts }).where(eq(channelVerifications.id, id));
}

export async function consumeVerification(id: string): Promise<void> {
  await db
    .update(channelVerifications)
    .set({ consumedAt: new Date() })
    .where(eq(channelVerifications.id, id));
}

/**
 * Mark a channel proven. Email has no timestamp of its own: better-auth already
 * owns `email_verified`, and a second source of truth for the same fact is how
 * they drift apart.
 */
export async function markVerified(userId: string, channel: Channel, at: Date): Promise<void> {
  const touched = { updatedAt: new Date() };
  const patch =
    channel === "email"
      ? { emailVerified: true, ...touched }
      : channel === "mobile"
        ? { mobileVerifiedAt: at, ...touched }
        : channel === "whatsapp"
          ? { whatsappVerifiedAt: at, ...touched }
          : channel === "telegram"
            ? { telegramVerifiedAt: at, ...touched }
            : { discordVerifiedAt: at, ...touched };

  await db.update(users).set(patch).where(eq(users.id, userId));
}

/**
 * Drop a channel's proof. Called when its address changes: a code sent to the old
 * mobile says nothing about the new one.
 */
export async function clearVerified(userId: string, channels: Channel[]): Promise<void> {
  if (channels.length === 0) return;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const channel of channels) {
    if (channel === "email") patch.emailVerified = false;
    if (channel === "mobile") patch.mobileVerifiedAt = null;
    if (channel === "whatsapp") patch.whatsappVerifiedAt = null;
    if (channel === "telegram") patch.telegramVerifiedAt = null;
    if (channel === "discord") patch.discordVerifiedAt = null;
  }
  await db.update(users).set(patch).where(eq(users.id, userId));
}
