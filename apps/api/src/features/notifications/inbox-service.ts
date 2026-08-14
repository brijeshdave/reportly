// Author: Brijesh Dave <https://github.com/brijeshdave>
// The caller's own view of notifications: reading the inbox, and setting what
// they receive.
//
// Separate from `service.ts`, which delivers. The two touch the same tables and
// otherwise have nothing to do with each other — one runs in a worker resolving
// an audience, this one answers a request about a single person.
import {
  CHANNEL_PROVIDERS,
  NOTIFICATION_DELIVERY,
  NOTIFICATION_TYPES,
  type Notification,
  type NotificationChannel,
  type NotificationPreferences,
  allowedChannelsFor,
  NOTIFICATION_MATRIX,
} from "@reportly/shared";

import { availability } from "@/core/channels/senders.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { contactsFor } from "@/features/notifications/audience-repo.js";
import * as repo from "@/features/notifications/repo.js";
import { channelEnabled, deliverableChannels } from "@/features/notifications/resolver.js";

function serialize(row: repo.NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    title: row.title,
    body: row.body,
    link: row.link,
    entityKind: row.entityKind,
    entityId: row.entityId,
    actorName: row.actorName,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function inbox(
  userId: string,
  companyId: string | null,
  options: { unreadOnly?: boolean; limit: number; offset: number },
): Promise<{ items: Notification[]; total: number }> {
  const [rows, total] = await Promise.all([
    repo.listInbox(userId, companyId, options),
    repo.countInbox(userId, companyId, options.unreadOnly ?? false),
  ]);
  return { items: rows.map(serialize), total };
}

export async function unread(
  userId: string,
  companyId: string | null,
): Promise<{ unread: number }> {
  return { unread: await repo.unreadCount(userId, companyId) };
}

export async function markRead(
  userId: string,
  companyId: string | null,
  ids?: string[],
): Promise<number> {
  return repo.markRead(userId, companyId, ids);
}

export async function archive(
  userId: string,
  companyId: string | null,
  id: string,
): Promise<boolean> {
  return repo.archive(userId, companyId, id);
}

/* ------------------------------- preferences ------------------------------- */

/**
 * The preference grid for one person.
 *
 * Every cell carries three facts, not one: what they receive, whether the
 * administrator permits it, and whether the channel can actually reach them. A
 * screen given only the first has to guess why a box is unticked, and guessing
 * wrong sends somebody to verify a phone number when the real answer is that
 * their administrator switched SMS off.
 *
 * Channels disabled system-wide are dropped from `channels` entirely rather than
 * shown dead in every row — a column of twenty permanently grey boxes is noise,
 * and the person cannot act on it.
 */
export async function preferences(userId: string): Promise<NotificationPreferences> {
  const [delivery, matrix, providers, overrides, contacts] = await Promise.all([
    getSystemSetting(NOTIFICATION_DELIVERY),
    getSystemSetting(NOTIFICATION_MATRIX),
    getSystemSetting(CHANNEL_PROVIDERS),
    repo.preferencesFor(userId),
    contactsFor([userId]),
  ]);

  const contact = contacts[0];
  const reachable = contact
    ? deliverableChannels(contact, availability(providers))
    : new Set<NotificationChannel>(["inapp"]);

  const stored = new Map(overrides.map((o) => [`${o.type}:${o.channel}`, o.enabled]));
  const channels = (
    ["inapp", "email", "mobile", "whatsapp", "telegram", "discord"] as const
  ).filter((channel) => channelEnabled(delivery, channel));

  const rows = NOTIFICATION_TYPES.map((def) => {
    const allowed = allowedChannelsFor(def.type, matrix);
    return {
      type: def.type,
      category: def.category,
      label: def.label,
      description: def.description,
      cells: channels.map((channel) => {
        const override = stored.get(`${def.type}:${channel}`);
        return {
          channel,
          // Defaults to on within what the administrator allows — the same rule
          // the resolver applies, so the screen cannot promise something the
          // dispatcher will not do.
          enabled: (override ?? true) && allowed.includes(channel),
          allowed: allowed.includes(channel),
          deliverable: reachable.has(channel),
          overridden: override !== undefined,
        };
      }),
    };
  });

  return { rows, channels: [...channels] };
}

/**
 * Store a person's choices.
 *
 * A cell set back to the current default is *cleared*, not written as `true`.
 * "Same as the default" and "chosen, and happens to match today's default" are
 * different states: the second stops following an administrator who later changes
 * the default, which is not what somebody ticking a box back on meant.
 */
export async function savePreferences(
  userId: string,
  input: { type: string; channel: NotificationChannel; enabled: boolean }[],
): Promise<NotificationPreferences> {
  const known = new Set(NOTIFICATION_TYPES.map((t) => t.type));
  const wanted = input.filter((pref) => known.has(pref.type));

  // The default is on for anything the administrator allows, so `enabled: true`
  // is the absence of an opinion.
  const toClear = wanted
    .filter((pref) => pref.enabled)
    .map(({ type, channel }) => ({ type, channel }));
  const toStore = wanted.filter((pref) => !pref.enabled);

  await repo.clearPreferences(userId, toClear);
  await repo.upsertPreferences(userId, toStore);

  return preferences(userId);
}
