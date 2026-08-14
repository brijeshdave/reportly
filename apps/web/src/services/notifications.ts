// Author: Brijesh Dave <https://github.com/brijeshdave>
// The signed-in user's own notifications and preferences. There is no
// administrator equivalent of these: the system-wide configuration is a setting,
// and goes through the settings service like every other one.
import type {
  Notification,
  NotificationChannel,
  NotificationPreferences,
  UnreadCount,
} from "@reportly/shared";

import { http } from "@/services/http.js";

export interface InboxPage {
  items: Notification[];
  total: number;
}

export function fetchNotifications(options: {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<InboxPage> {
  const params = new URLSearchParams();
  if (options.unreadOnly) params.set("unreadOnly", "true");
  params.set("limit", String(options.limit ?? 20));
  params.set("offset", String(options.offset ?? 0));
  return http.get<InboxPage>(`/me/notifications?${params.toString()}`);
}

export function fetchUnreadCount(): Promise<UnreadCount> {
  return http.get<UnreadCount>("/me/notifications/unread-count");
}

/** Omit `ids` to mark the whole inbox read. */
export function markNotificationsRead(ids?: string[]): Promise<{ marked: number }> {
  return http.post<{ marked: number }>("/me/notifications/read", ids ? { ids } : {});
}

export function archiveNotification(id: string): Promise<void> {
  return http.post<void>(`/me/notifications/${id}/archive`);
}

export function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  return http.get<NotificationPreferences>("/me/notification-preferences");
}

export function saveNotificationPreferences(
  preferences: { type: string; channel: NotificationChannel; enabled: boolean }[],
): Promise<NotificationPreferences> {
  return http.put<NotificationPreferences>("/me/notification-preferences", { preferences });
}
