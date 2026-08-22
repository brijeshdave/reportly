// Author: Brijesh Dave <https://github.com/brijeshdave>
// Delivering one event to everybody it concerns.
//
// This runs in the worker, never in a request. Resolving an audience means a
// recursive walk up a reporting line or a "who in this company holds
// journal:review" join, and neither belongs on the path of the person who merely
// filed something. One enqueued job covers a fan-out of any size.
import {
  CHANNEL_PROVIDERS,
  NOTIFICATION_DELIVERY,
  NOTIFICATION_MATRIX,
  type NotificationChannel,
  asContactChannel,
  findNotificationType,
} from "@reportly/shared";

import { availability, sendToChannel } from "@/core/channels/senders.js";
import { env } from "@/core/env.js";
import { logger } from "@/core/logger.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { resolveAudience, type NotificationEvent } from "@/features/notifications/audience.js";
import { contactsFor, type ContactRow } from "@/features/notifications/audience-repo.js";
import {
  insertNotifications,
  preferencesForMany,
  type NewNotification,
} from "@/features/notifications/repo.js";
import {
  channelsFor,
  deliverableChannels,
  toOverrideMap,
} from "@/features/notifications/resolver.js";

/** Everything an emitter hands over: the event, plus what it should say. */
export interface NotificationRequest extends NotificationEvent {
  title: string;
  body?: string;
  /** An app route, e.g. `/journal/<id>`. Turned into a URL only for email. */
  link?: string | null;
  entityKind?: string | null;
  entityId?: string | null;
}

/** Where a contact channel points for this person, or null if it has none. */
function destinationFor(contact: ContactRow, channel: NotificationChannel): string | null {
  switch (channel) {
    case "email":
      return contact.email;
    case "mobile":
    case "whatsapp":
    case "telegram":
      return contact.mobile;
    case "discord":
      return contact.discordHandle;
    default:
      return null;
  }
}

/**
 * Resolve, record, and send.
 *
 * The inbox row is written before anything leaves the building, and a provider
 * that throws is logged rather than raised: one unreachable Discord handle must
 * not cost the other fourteen recipients their notification, and the job has
 * already done the part that matters.
 */
export async function dispatch(request: NotificationRequest): Promise<number> {
  const def = findNotificationType(request.type);
  if (!def) {
    logger.warn(
      { type: request.type },
      "Refusing to send a notification type not in the catalogue",
    );
    return 0;
  }

  const [delivery, matrix, providers] = await Promise.all([
    getSystemSetting(NOTIFICATION_DELIVERY),
    getSystemSetting(NOTIFICATION_MATRIX),
    getSystemSetting(CHANNEL_PROVIDERS),
  ]);

  const recipients = await resolveAudience(request);
  if (recipients.length === 0) return 0;

  const [contacts, overrides] = await Promise.all([
    contactsFor(recipients),
    preferencesForMany(recipients),
  ]);
  const available = availability(providers);

  const inbox: NewNotification[] = [];
  const sends: { contact: ContactRow; channel: NotificationChannel }[] = [];

  for (const contact of contacts) {
    const channels = channelsFor(
      request.type,
      {
        userId: contact.userId,
        deliverable: deliverableChannels(contact, available),
        overrides: toOverrideMap(overrides.get(contact.userId) ?? []),
      },
      matrix,
      delivery,
    );

    for (const channel of channels) {
      if (channel === "inapp") {
        inbox.push({
          // Null for a system-wide event: the row belongs to no tenant and is
          // shown in every company context rather than hidden behind whichever
          // one happens to be selected.
          companyId: request.companyId,
          userId: contact.userId,
          type: request.type,
          category: def.category,
          title: request.title,
          body: request.body ?? "",
          link: request.link ?? null,
          entityKind: request.entityKind ?? null,
          entityId: request.entityId ?? null,
          actorUserId: request.actorUserId,
        });
      } else {
        sends.push({ contact, channel });
      }
    }
  }

  await insertNotifications(inbox);

  for (const { contact, channel } of sends) {
    const destination = destinationFor(contact, channel);
    // The resolver already said this channel is deliverable, so a missing
    // destination here means the two disagree. Log it rather than throw: it is a
    // bug in the resolver, not a reason to drop the rest of the fan-out.
    if (!destination) {
      logger.warn({ channel, userId: contact.userId }, "Deliverable channel with no destination");
      continue;
    }
    const contactChannel = asContactChannel(channel);
    if (!contactChannel) continue;

    try {
      await sendToChannel(
        providers,
        contactChannel,
        destination,
        request.title,
        request.body ?? "",
        request.link ? `${env.WEB_URL}${request.link}` : undefined,
        // So the outbound log can answer "did the downtime alerts go out?" by
        // event type, rather than by guessing from subject lines.
        { toUserId: contact.userId, eventType: request.type, companyId: request.companyId },
      );
    } catch (error) {
      // One unreachable handle must not cost the other recipients their message.
      // The inbox row is already written, so nothing is lost that mattered.
      logger.warn(
        { err: error, channel, userId: contact.userId, type: request.type },
        "A notification channel refused the message",
      );
    }
  }

  logger.info(
    { type: request.type, recipients: contacts.length, inbox: inbox.length, sends: sends.length },
    "Notification dispatched",
  );
  return inbox.length + sends.length;
}
