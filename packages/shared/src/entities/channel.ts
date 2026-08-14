// Author: Brijesh Dave <https://github.com/brijeshdave>
// Contact-channel contracts. A user is reachable on several channels; each is
// verified independently by a one-time code sent to it. Email is the only
// required channel — the rest are optional and may be left unverified.
//
// WhatsApp and Telegram are addressed by the user's mobile number, so they are
// flags on it rather than fields of their own. Discord is not phone-addressable,
// so it carries its own handle.
import { z } from "zod";

export const CHANNELS = ["email", "mobile", "whatsapp", "telegram", "discord"] as const;
export type Channel = (typeof CHANNELS)[number];
export const channelSchema = z.enum(CHANNELS);

/** How a channel stands for one user: where it points, and whether it is proven. */
export const channelStatusSchema = z.object({
  channel: channelSchema,
  /** The address a code would go to (email, mobile, Discord handle), or null. */
  destination: z.string().nullable(),
  verified: z.boolean(),
  verifiedAt: z.string().datetime().nullable(),
  /**
   * Whether a sender is configured for this channel at all. Email always is;
   * the others need a provider (see the `channels` settings). An unavailable
   * channel cannot be verified, and the UI says so rather than failing silently.
   */
  available: z.boolean(),
});

export type ChannelStatus = z.infer<typeof channelStatusSchema>;

export const requestChannelCodeSchema = z.object({ channel: channelSchema });
export type RequestChannelCode = z.infer<typeof requestChannelCodeSchema>;

export const confirmChannelCodeSchema = z.object({
  channel: channelSchema,
  code: z.string().trim().min(4).max(12),
});
export type ConfirmChannelCode = z.infer<typeof confirmChannelCodeSchema>;

/** What a code request tells the caller: when it lapses, never the code itself. */
export const channelCodeSentSchema = z.object({
  channel: channelSchema,
  expiresAt: z.string().datetime(),
});
export type ChannelCodeSent = z.infer<typeof channelCodeSentSchema>;
