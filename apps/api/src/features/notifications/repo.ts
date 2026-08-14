// Author: Brijesh Dave <https://github.com/brijeshdave>
// The only code that touches `notifications` and `notification_preferences`.
//
// Every inbox read takes a user AND a company. The user alone would look
// sufficient — a notification belongs to exactly one person — but somebody in two
// companies reads their bell under an active one, and a query scoped only by user
// shows them the other tenant's business while they are working in this one.
//
// A NULL company is the app's "All companies" state, not a missing filter. There
// the person is deliberately looking across everything they have access to, and
// every row is still their own: the company condition is what narrows the view,
// never what authorises it. That distinction is why this is safe and SF-006 was
// not — there, the company was the only thing standing between two tenants.
import { and, count, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { notificationPreferences, notifications, users } from "@/core/db/schema.js";

/**
 * The company narrowing.
 *
 * Nothing at all when the caller is on "All companies". Otherwise the active
 * company OR no company: a row with a null company is about the installation —
 * a failed backup, a jammed queue — and belongs in every context, because hiding
 * it behind whichever company is selected is how an operator misses it.
 */
function inCompany(companyId: string | null): SQL | undefined {
  return companyId
    ? or(eq(notifications.companyId, companyId), isNull(notifications.companyId))
    : undefined;
}

export interface NewNotification {
  /** Null when the event concerns the installation rather than a tenant. */
  companyId: string | null;
  userId: string;
  type: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  entityKind: string | null;
  entityId: string | null;
  actorUserId: string | null;
}

export interface NotificationRow {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  entityKind: string | null;
  entityId: string | null;
  actorName: string | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One insert for the whole fan-out — a hundred recipients is one round trip. */
export async function insertNotifications(rows: NewNotification[]): Promise<number> {
  if (rows.length === 0) return 0;
  await db.insert(notifications).values(rows);
  return rows.length;
}

/** The caller's inbox, newest first. Archived rows are gone from every view. */
export async function listInbox(
  userId: string,
  companyId: string | null,
  options: { unreadOnly?: boolean; limit: number; offset: number },
): Promise<NotificationRow[]> {
  const where = and(
    eq(notifications.userId, userId),
    inCompany(companyId),
    isNull(notifications.archivedAt),
    options.unreadOnly ? isNull(notifications.readAt) : undefined,
  );

  return (
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        category: notifications.category,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        entityKind: notifications.entityKind,
        entityId: notifications.entityId,
        actorName: users.name,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        updatedAt: notifications.updatedAt,
      })
      .from(notifications)
      // Left, not inner: the actor is null for anything the system did on its own,
      // and an inner join would silently drop every one of those from the inbox.
      .leftJoin(users, eq(users.id, notifications.actorUserId))
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(options.limit)
      .offset(options.offset)
  );
}

export async function countInbox(
  userId: string,
  companyId: string | null,
  unreadOnly: boolean,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        inCompany(companyId),
        isNull(notifications.archivedAt),
        unreadOnly ? isNull(notifications.readAt) : undefined,
      ),
    );
  return Number(row?.n ?? 0);
}

/** How many unread the bell shows. Hit by every client on a timer, so it counts
 *  nothing it does not have to: the index is (user, company, read_at). */
export async function unreadCount(userId: string, companyId: string | null): Promise<number> {
  return countInbox(userId, companyId, true);
}

/** Mark specific ids read, or the whole company inbox when `ids` is omitted. */
export async function markRead(
  userId: string,
  companyId: string | null,
  ids?: string[],
): Promise<number> {
  if (ids && ids.length === 0) return 0;
  const result = await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        inCompany(companyId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    );
  return result.rowCount ?? 0;
}

export async function archive(
  userId: string,
  companyId: string | null,
  id: string,
): Promise<boolean> {
  const result = await db
    .update(notifications)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), inCompany(companyId)));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Delete read notifications older than the cutoff, in every company.
 *
 * Read only. An inbox that quietly deletes what you have not opened is worse than
 * a long one — the whole point of the bell is that nothing goes missing.
 */
export async function pruneRead(before: Date): Promise<number> {
  const result = await db
    .delete(notifications)
    .where(and(sql`${notifications.readAt} is not null`, lt(notifications.readAt, before)));
  return result.rowCount ?? 0;
}

/* ------------------------------- preferences ------------------------------- */

export interface PreferenceRow {
  type: string;
  channel: string;
  enabled: boolean;
}

/** One user's overrides. Absent rows mean "follow the system default". */
export async function preferencesFor(userId: string): Promise<PreferenceRow[]> {
  return db
    .select({
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
}

/** The overrides of many users at once — the worker resolves a fan-out in one read. */
export async function preferencesForMany(userIds: string[]): Promise<Map<string, PreferenceRow[]>> {
  const out = new Map<string, PreferenceRow[]>();
  if (userIds.length === 0) return out;

  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, userIds));

  for (const row of rows) {
    const list = out.get(row.userId) ?? [];
    list.push({ type: row.type, channel: row.channel, enabled: row.enabled });
    out.set(row.userId, list);
  }
  return out;
}

export async function upsertPreferences(
  userId: string,
  prefs: { type: string; channel: string; enabled: boolean }[],
): Promise<void> {
  if (prefs.length === 0) return;
  await db
    .insert(notificationPreferences)
    .values(prefs.map((p) => ({ userId, ...p })))
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.type,
        notificationPreferences.channel,
      ],
      set: { enabled: sql`excluded.enabled`, updatedAt: new Date() },
    });
}

/**
 * Drop an override so the cell inherits again.
 *
 * "Same as the default" and "explicitly chosen, and happens to match today's
 * default" are different states: the second stops following an administrator who
 * later changes the default. Clearing is how a user says the first.
 */
export async function clearPreferences(
  userId: string,
  cells: { type: string; channel: string }[],
): Promise<void> {
  for (const cell of cells) {
    await db
      .delete(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.type, cell.type),
          eq(notificationPreferences.channel, cell.channel),
        ),
      );
  }
}
