// Author: Brijesh Dave <https://github.com/brijeshdave>
// Notifications: the catalogue of things worth telling somebody about, and the
// contracts for an inbox, a preference, and the admin matrix that bounds both.
//
// The catalogue is declared here once and read three ways — the API emits against
// it, the admin screen configures it, the preference screen offers it. That is the
// same arrangement as the permission list and the settings registry, and for the
// same reason: a type that exists in one place and not another is the bug this
// codebase keeps producing.
//
// It is deliberately NOT the audit action list. Audit records everything that
// happened, because the question it answers is "what changed"; a notification is
// only for what a person has to act on or would want to know. Creating a category
// is auditable and would be noise in an inbox.
import { z } from "zod";

import { CHANNELS, channelSchema, type Channel } from "@/entities/channel.js";
import { timestampsSchema, uuidSchema } from "@/entities/common.js";

/**
 * Where a notification can land.
 *
 * The bell is a delivery channel like any other, so it sits alongside the contact
 * channels rather than beside them as a special case — one matrix configures all
 * six, and the resolver has no branch for "the in-app one".
 */
export const NOTIFICATION_CHANNELS = ["inapp", ...CHANNELS] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

/** True for the five channels that need a verified destination and a provider. */
export function isContactChannel(channel: NotificationChannel): channel is Channel {
  return channel !== "inapp";
}

/** Narrow a notification channel to a contact channel, or null for in-app. */
export function asContactChannel(channel: NotificationChannel): Channel | null {
  return isContactChannel(channel) ? channelSchema.parse(channel) : null;
}

/**
 * Who receives a type.
 *
 * Declared with the type rather than passed at every call site, so the answer to
 * "who gets told when an entry is rejected" lives in one place and cannot differ
 * between the two routes that can reject one.
 *
 *   author     — whoever filed the thing
 *   assignee   — whoever it is assigned to now
 *   upline     — the reporting line above the subject, depth-capped
 *   department — everyone in the subject's department
 *   explicit   — ids the emitting call site passes (a swap partner)
 *   operators  — everyone holding a named permission, ACROSS every company
 *
 * `operators` is the only audience that ignores company, and it exists for the
 * only events that have none: a failed backup, a jammed queue. Narrowing those to
 * a tenant would silently drop the administrator who happens to be a member of a
 * different one. It arrived with its first caller, having been written and
 * removed once for having none.
 */
export const NOTIFICATION_AUDIENCES = [
  "author",
  "assignee",
  "upline",
  "department",
  "explicit",
  "operators",
] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/** Catalogue groupings — the section headings on both configuration screens. */
export const NOTIFICATION_CATEGORIES = [
  "journal",
  "tasks",
  "shifts",
  "routines",
  "downtime",
  // Its own heading rather than folded into "system": for a company that has the
  // module off, a whole section is easy to skip, whereas two cartridge rows
  // buried among the backup ones read as clutter nobody can switch off.
  "cartridges",
  "system",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationTypeDef {
  type: string;
  category: NotificationCategory;
  /** What the reader sees as the row label on the preference screen. */
  label: string;
  /** What causes it, in a sentence. Shown under the label. */
  description: string;
  audience: NotificationAudience;
  /** Required when `audience` is `"operators"` — the permission that defines them. */
  permission?: string;
  /**
   * True when the event concerns the installation rather than a tenant. Such a
   * notification is stored with no company and is shown in every company context,
   * because hiding it behind whichever company happens to be selected is how an
   * operator misses a failing backup.
   */
  systemWide?: boolean;
  /**
   * The channels a fresh install sends on, before an administrator has chosen.
   * In-app is on everywhere (see `DEFAULT_INAPP` below); anything beyond that is
   * an opinion about what is worth an interruption.
   *
   * This only *seeds* the admin matrix. Once an administrator edits a type's row,
   * their row is the default and this stops being consulted.
   */
  defaultChannels: readonly NotificationChannel[];
}

/**
 * In-app is the floor.
 *
 * It defaults on for every type so the bell stays a complete record even for
 * someone who has switched off every outbound channel — "I never heard about it"
 * should always have an answer. It is still a default and not a lock: the admin
 * matrix can withdraw it, and a user can turn it off per type.
 */
const DEFAULT_INAPP: readonly NotificationChannel[] = ["inapp"];
const INAPP_AND_EMAIL: readonly NotificationChannel[] = ["inapp", "email"];

export const NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  // --- journal ---
  {
    type: "journal.assigned",
    category: "journal",
    label: "An entry was assigned to you",
    description: "Somebody put a journal entry in your hands.",
    audience: "assignee",
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    type: "journal.commented",
    category: "journal",
    label: "Someone commented on your entry",
    description: "A remark was added to an entry you filed or hold.",
    audience: "author",
    defaultChannels: DEFAULT_INAPP,
  },
  {
    type: "journal.status-changed",
    category: "journal",
    label: "Your entry changed status",
    description: "An entry you filed moved to a different status.",
    audience: "author",
    defaultChannels: DEFAULT_INAPP,
  },
  {
    type: "journal.scored",
    category: "journal",
    label: "Your entry was appraised",
    description: "A reviewer scored an entry you worked on, and points were awarded.",
    audience: "author",
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    type: "journal.rejected",
    category: "journal",
    label: "Your entry was rejected",
    description: "A head of department rejected an entry, voiding its points.",
    audience: "author",
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    type: "journal.reopened",
    category: "journal",
    label: "Your entry was reopened",
    description: "An entry that had been finished was opened again.",
    audience: "author",
    defaultChannels: DEFAULT_INAPP,
  },
  {
    type: "journal.awaiting-review",
    category: "journal",
    label: "An entry is waiting for your review",
    description: "Somebody in your reporting line filed work that needs appraising.",
    audience: "upline",
    defaultChannels: INAPP_AND_EMAIL,
  },

  // --- tasks ---
  {
    type: "task.assigned",
    category: "tasks",
    label: "A task was assigned to you",
    description: "You were named on a task.",
    audience: "assignee",
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    type: "task.due-soon",
    category: "tasks",
    label: "A task of yours is due soon",
    description: "A task you hold reaches its due date within a day.",
    audience: "assignee",
    defaultChannels: DEFAULT_INAPP,
  },

  // --- routines ---
  {
    type: "routine.due-soon",
    category: "routines",
    label: "A routine of yours is due soon",
    description: "Recurring work assigned to you comes due tomorrow.",
    audience: "assignee",
    defaultChannels: DEFAULT_INAPP,
  },
  {
    type: "routine.overdue",
    category: "routines",
    label: "A routine of yours is overdue",
    description: "Recurring work assigned to you passed its date without a log.",
    audience: "assignee",
    defaultChannels: INAPP_AND_EMAIL,
  },

  // --- shifts ---
  {
    type: "shift.swap.requested",
    category: "shifts",
    label: "A colleague asked to swap with you",
    description: "Somebody proposed exchanging a shift with one of yours.",
    audience: "explicit",
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    type: "shift.swap.decided",
    category: "shifts",
    label: "Your swap request was decided",
    description: "A swap you asked for was approved or refused.",
    audience: "explicit",
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    type: "shift.schedule.published",
    category: "shifts",
    label: "A schedule was published",
    description: "Your department's roster for a period was released.",
    audience: "department",
    defaultChannels: INAPP_AND_EMAIL,
  },

  {
    type: "routine.awarded",
    category: "routines",
    label: "Routine points were awarded",
    description: "The month closed and your routine compliance was scored.",
    audience: "assignee",
    defaultChannels: DEFAULT_INAPP,
  },

  // --- cartridges ---
  {
    // The one notification in this module that somebody must not miss: their
    // score changed, and it went down. Discovering that on a leaderboard next
    // week, with no message and nothing to look at, is how a scoring scheme
    // stops being believed.
    type: "part.points-reversed",
    category: "cartridges",
    label: "Points for a service were taken back",
    description: "A part you refilled or repaired came back faulty inside the failure window.",
    audience: "explicit",
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    // Advisory, like the flag it reports. It says a part has reached the end of
    // what its maker rated it for; it does not say stop, because the technician
    // holding it has better information than the figure on the box.
    //
    // Aimed at whoever may retire a part rather than at whoever just serviced it:
    // the technician already sees the flag on the screen in front of them, and
    // scrapping is somebody else's decision. `operators` without `systemWide` is
    // the combination that means "holders of this permission, in this company" —
    // the module belongs to a tenant, unlike a failing backup.
    type: "part.over-cycle-limit",
    category: "cartridges",
    label: "A part passed its rated cycles",
    description: "A part has now had more services than its model is rated for.",
    audience: "operators",
    permission: "parts:manage",
    defaultChannels: DEFAULT_INAPP,
  },

  // --- system ---
  {
    type: "backup.failed",
    category: "system",
    label: "A backup failed",
    description: "A scheduled database or file backup did not complete.",
    audience: "operators",
    permission: "backups:manage",
    systemWide: true,
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    type: "queue.jobs-failing",
    category: "system",
    label: "Background jobs are failing",
    description: "A queue has accumulated failed jobs since the last check.",
    audience: "operators",
    permission: "queues:view",
    systemWide: true,
    defaultChannels: INAPP_AND_EMAIL,
  },
  {
    type: "user.invited",
    category: "system",
    label: "Somebody was invited",
    description: "A new account was invited and has not signed in yet.",
    audience: "operators",
    permission: "users:create",
    systemWide: true,
    defaultChannels: DEFAULT_INAPP,
  },

  // --- downtime ---
  {
    type: "downtime.opened",
    category: "downtime",
    label: "Downtime was opened",
    description: "An asset in your department went down.",
    audience: "department",
    defaultChannels: DEFAULT_INAPP,
  },
  {
    type: "downtime.closed",
    category: "downtime",
    label: "Downtime was closed",
    description: "An asset in your department came back.",
    audience: "department",
    defaultChannels: DEFAULT_INAPP,
  },
];

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]["type"];

/** All type keys, for validating stored configuration against the catalogue. */
export const ALL_NOTIFICATION_TYPES: readonly string[] = NOTIFICATION_TYPES.map((t) => t.type);

export function findNotificationType(type: string): NotificationTypeDef | undefined {
  return NOTIFICATION_TYPES.find((t) => t.type === type);
}

/* --------------------------------- inbox ---------------------------------- */

/**
 * One notification as the bell and the list show it.
 *
 * `link` is a route, not a URL: the client is the only thing that knows its own
 * origin, and a stored absolute URL breaks the day the app moves host.
 */
export const notificationSchema = z
  .object({
    id: uuidSchema,
    type: z.string(),
    category: z.string(),
    title: z.string(),
    body: z.string(),
    link: z.string().nullable(),
    entityKind: z.string().nullable(),
    entityId: z.string().nullable(),
    actorName: z.string().nullable(),
    readAt: z.string().datetime().nullable(),
  })
  .merge(timestampsSchema);
export type Notification = z.infer<typeof notificationSchema>;

/** What the bell polls for: the badge number, on its own so it stays cheap. */
export const unreadCountSchema = z.object({ unread: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

export const markNotificationsReadSchema = z.object({
  /** Specific ids, or omit to mark the whole inbox read. */
  ids: z.array(uuidSchema).max(200).optional(),
});
export type MarkNotificationsRead = z.infer<typeof markNotificationsReadSchema>;

/* ------------------------------- preferences ------------------------------- */

/**
 * One user's answer for one type on one channel.
 *
 * Only overrides are stored. A (type, channel) a user has never touched follows
 * the system default, which is how "set the default for everyone" works without a
 * backfill — and how a type added to the catalogue next year arrives with a
 * sensible answer for people who signed up this year.
 */
export const notificationPreferenceSchema = z.object({
  type: z.string(),
  channel: notificationChannelSchema,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const updateNotificationPreferencesSchema = z.object({
  preferences: z.array(notificationPreferenceSchema).max(500),
});
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;

/**
 * A row of the preference screen: what this user would receive today, and why a
 * cell they cannot use is closed to them.
 *
 * `allowed` says the admin permits it; `deliverable` says the channel is verified
 * and its provider configured. Both are sent because they are different sentences
 * on screen — "your administrator has turned this off" and "verify your mobile
 * first" — and a screen that cannot tell them apart tells the reader to fix the
 * wrong thing.
 */
export const notificationPreferenceCellSchema = z.object({
  channel: notificationChannelSchema,
  enabled: z.boolean(),
  allowed: z.boolean(),
  deliverable: z.boolean(),
  /** Whether the stored value is this user's own choice or the inherited default. */
  overridden: z.boolean(),
});

export const notificationPreferenceRowSchema = z.object({
  type: z.string(),
  category: z.string(),
  label: z.string(),
  description: z.string(),
  cells: z.array(notificationPreferenceCellSchema),
});
export type NotificationPreferenceRow = z.infer<typeof notificationPreferenceRowSchema>;

export const notificationPreferencesSchema = z.object({
  rows: z.array(notificationPreferenceRowSchema),
  /** Channels switched off system-wide are hidden entirely rather than shown dead. */
  channels: z.array(notificationChannelSchema),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/* --------------------------- the admin matrix ------------------------------ */

/**
 * Which channels the administrator permits per type — the outer bound on every
 * user's preference.
 *
 * A record keyed by type rather than a fixed object, so adding a type to the
 * catalogue does not require a migration of the stored value. Unknown keys are
 * dropped on read (a type removed from the catalogue must not keep configuring
 * anything), and a type absent from the record falls back to its declared
 * defaults.
 */
export const notificationMatrixSchema = z
  .record(z.string(), z.array(notificationChannelSchema))
  .default({});
export type NotificationMatrix = z.infer<typeof notificationMatrixSchema>;

/**
 * The channels allowed for a type: the stored row if there is one, else the
 * type's declared defaults. Unknown types resolve to nothing rather than to
 * everything — a message with no catalogue entry has no audience either.
 */
export function allowedChannelsFor(
  type: string,
  matrix: NotificationMatrix,
): readonly NotificationChannel[] {
  const def = findNotificationType(type);
  if (!def) return [];
  return matrix[type] ?? def.defaultChannels;
}
