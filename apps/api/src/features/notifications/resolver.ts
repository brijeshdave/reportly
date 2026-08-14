// Author: Brijesh Dave <https://github.com/brijeshdave>
// Which channels one person actually receives one notification type on.
//
// Three gates, and a message needs all three:
//
//   1. the administrator permits the type on that channel, and the channel is
//      switched on system-wide
//   2. the person has not opted out
//   3. the channel can reach them — verified destination, configured provider
//
// Deliberately pure. The gates are the part that has to be *obviously* right, and
// a function that also reads the database can only be tested with one. Everything
// here takes its facts as arguments; the worker does the fetching.
import {
  type NotificationChannel,
  type NotificationDeliverySettings,
  type NotificationMatrix,
  allowedChannelsFor,
  findNotificationType,
} from "@reportly/shared";

import type { ContactRow } from "@/features/notifications/audience-repo.js";

/** A user's stored overrides, keyed for lookup. Absent means "inherit". */
export type OverrideMap = Map<string, boolean>;

export function overrideKey(type: string, channel: NotificationChannel): string {
  return `${type}:${channel}`;
}

export function toOverrideMap(rows: { type: string; channel: string; enabled: boolean }[]) {
  const map: OverrideMap = new Map();
  for (const row of rows) map.set(`${row.type}:${row.channel}`, row.enabled);
  return map;
}

/** Gate 1's first half: the master switch for a channel, system-wide. */
export function channelEnabled(
  delivery: NotificationDeliverySettings,
  channel: NotificationChannel,
): boolean {
  switch (channel) {
    case "inapp":
      return delivery.inappEnabled;
    case "email":
      return delivery.emailEnabled;
    case "mobile":
      return delivery.mobileEnabled;
    case "whatsapp":
      return delivery.whatsappEnabled;
    case "telegram":
      return delivery.telegramEnabled;
    case "discord":
      return delivery.discordEnabled;
  }
}

/**
 * Gate 3: where this person can actually be reached.
 *
 * In-app needs nothing. Email is treated as reachable without a verification
 * timestamp, because it is the required channel — an account is created against
 * an address and invited over it, so demanding proof here would silence every
 * user an administrator ever added. The other four are opt-in contact details and
 * must be proven, or a notification goes to a phone number somebody mistyped.
 *
 * `availableProviders` is the second half: a verified WhatsApp number is no use
 * when no gateway is configured, and pretending otherwise produces a message that
 * fails in a worker where nobody sees it.
 */
export function deliverableChannels(
  contact: ContactRow,
  availableProviders: Record<string, boolean>,
): Set<NotificationChannel> {
  const out = new Set<NotificationChannel>(["inapp"]);
  if (contact.email) out.add("email");
  if (contact.mobile && contact.mobileVerifiedAt) out.add("mobile");
  if (contact.mobile && contact.whatsappOnMobile && contact.whatsappVerifiedAt) out.add("whatsapp");
  if (contact.mobile && contact.telegramOnMobile && contact.telegramVerifiedAt) out.add("telegram");
  if (contact.discordHandle && contact.discordVerifiedAt) out.add("discord");

  for (const channel of [...out]) {
    // The mailer is part of the app, so email has no provider to check.
    if (channel === "inapp" || channel === "email") continue;
    if (!availableProviders[channel]) out.delete(channel);
  }
  return out;
}

export interface RecipientState {
  userId: string;
  deliverable: Set<NotificationChannel>;
  overrides: OverrideMap;
}

/**
 * The answer: the channels this notification goes out on for this person.
 *
 * Order follows the catalogue's channel order, so a message is always written to
 * the inbox before it is sent anywhere else. If a provider throws, the record of
 * what happened already exists.
 */
export function channelsFor(
  type: string,
  recipient: RecipientState,
  matrix: NotificationMatrix,
  delivery: NotificationDeliverySettings,
): NotificationChannel[] {
  const def = findNotificationType(type);
  // A type that is not in the catalogue has no audience and no configuration.
  // Silently sending it on some default would be worse than dropping it: nobody
  // could turn it off, because it would not appear on any screen.
  if (!def) return [];

  /**
   * The administrator's row is BOTH the bound and the default.
   *
   * One list, not two. The alternative — "permitted" and "on by default" as
   * separate sets — buys the ability to offer a channel a user must opt into, and
   * costs a tri-state cell in every square of a twenty-by-six grid on the admin
   * screen. Setting a default for everyone is the thing that was actually asked
   * for; opting in beyond what the administrator chose was not.
   *
   * So the catalogue's `defaultChannels` seeds this row and stops mattering the
   * moment an administrator edits it, and a user's own choice is a mute or an
   * un-mute *within* it.
   */
  const allowed = allowedChannelsFor(type, matrix);

  return allowed.filter((channel) => {
    if (!channelEnabled(delivery, channel)) return false;
    if (!recipient.deliverable.has(channel)) return false;

    return recipient.overrides.get(overrideKey(type, channel)) ?? true;
  });
}
