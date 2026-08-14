// Author: Brijesh Dave <https://github.com/brijeshdave>
// The bell in the topbar: an unread count, and the last few notifications.
//
// The badge is polled (see `unreadCountQuery`); the list is not. Fetching twenty
// rows every minute to render one number would make the most-called query in the
// app also the most expensive, so the panel loads its contents when it is opened
// and not before.
import { formatDateTime } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, Check } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn.js";
import { queryKeys, unreadCountQuery } from "@/lib/queries.js";
import { fetchNotifications, markNotificationsRead } from "@/services/notifications.js";

/** How many the panel shows before sending the reader to the full page. */
const PANEL_SIZE = 8;

/**
 * "3 minutes ago" rather than a timestamp.
 *
 * A notification's age is what a reader is judging — whether this is news — and a
 * clock time makes them do the subtraction. Past a week it flips to a date,
 * because "412 hours ago" is not an improvement on a date.
 */
function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return formatDateTime(iso);
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: count } = useQuery(unreadCountQuery);
  const unread = count?.unread ?? 0;

  const { data, isPending, isError } = useQuery({
    queryKey: [...queryKeys.notifications, "panel"],
    queryFn: () => fetchNotifications({ limit: PANEL_SIZE }),
    // Only once the panel is open. A closed dropdown fetching a list is work
    // nobody asked for, on every page load, for every user.
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        // Named with the count, not just "Notifications": a screen reader user
        // gets the badge's information, which is the only reason the badge exists.
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border hover:bg-muted"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unread > 0 ? (
          // Capped at 9+. The badge is a "there is something waiting" signal, and
          // past a point the exact number changes nothing a reader would do.
          <span className="brand-gradient absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* A full-screen catcher so a click anywhere else closes the panel. */}
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Notifications"
            className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-border bg-card shadow-lg sm:w-96"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-medium">Notifications</p>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => markRead.mutate(undefined)}
                  disabled={markRead.isPending}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  Mark all read
                </button>
              ) : null}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {isError ? (
                // Said in words. A panel that sits on "Loading…" for ever is the
                // most confusing possible outcome — it reads as slow, not broken.
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Your notifications could not be loaded.
                </p>
              ) : isPending ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (data?.items.length ?? 0) === 0 ? (
                // In words, not an empty box. An empty list looks like a screen
                // that failed to load.
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nothing new. You are up to date.
                </p>
              ) : (
                <ul>
                  {data!.items.map((item) => {
                    const body = (
                      <>
                        <span className="flex items-start gap-2">
                          {!item.readAt ? (
                            <span
                              className="brand-gradient mt-1.5 h-2 w-2 shrink-0 rounded-full"
                              aria-hidden
                            />
                          ) : (
                            <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />
                          )}
                          <span className="min-w-0">
                            <span
                              className={cn(
                                "block text-sm",
                                item.readAt ? "text-muted-foreground" : "font-medium",
                              )}
                            >
                              {item.title}
                            </span>
                            {item.body ? (
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {item.body}
                              </span>
                            ) : null}
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {relativeTime(item.createdAt)}
                              {item.actorName ? ` · ${item.actorName}` : ""}
                            </span>
                          </span>
                        </span>
                      </>
                    );

                    return (
                      <li key={item.id} className="border-b border-border/60 last:border-0">
                        {item.link ? (
                          <Link
                            to={item.link}
                            role="menuitem"
                            onClick={() => {
                              // Opening it is reading it. Making somebody tick a
                              // box as well as follow the link is a second action
                              // for something they have already done.
                              if (!item.readAt) markRead.mutate([item.id]);
                              setOpen(false);
                            }}
                            className="block px-3 py-2 hover:bg-muted"
                          >
                            {body}
                          </Link>
                        ) : (
                          <div className="px-3 py-2">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-border px-3 py-2">
              <Link
                to="/notifications"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block text-center text-xs text-muted-foreground hover:text-foreground"
              >
                See all notifications
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
