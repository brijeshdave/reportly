// Author: Brijesh Dave <https://github.com/brijeshdave>
// Everything the bell only shows eight of.
//
// Reached from the bell rather than the sidebar. The sidebar is nine groups
// already, and this is a personal surface with a permanent entry point three
// pixels from where a notification appears — a tenth navigation entry would cost
// every user vertical space to save one of them a click.
import { formatDateTime } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Settings2, X } from "lucide-react";
import { useState } from "react";

import { PageTabs } from "@/components/page-tabs.js";
import { Spinner } from "@/components/ui/form.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { queryKeys } from "@/lib/queries.js";
import {
  archiveNotification,
  fetchNotifications,
  markNotificationsRead,
} from "@/services/notifications.js";

const PAGE_SIZE = 30;

/**
 * Two lanes and the full record.
 *
 * Reported from use: "for in app notifications it should differ from other as
 * currently it is being cluttered with many and I am not able to find on which I
 * should be focusing." Everything still arrives — the bell is meant to be a complete
 * record — but what is waiting on you is no longer sitting between two things that
 * are not. **Needs you** opens first, because that is the question people come here
 * with.
 */
const TABS = [
  { id: "needs-you", label: "Needs you" },
  { id: "activity", label: "Activity" },
  { id: "all", label: "Everything" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function NotificationsPage() {
  const [tab, setTab] = useState<TabId>("needs-you");
  const queryClient = useQueryClient();

  const lane = tab === "needs-you" ? "action" : tab === "activity" ? "activity" : undefined;
  const { data, isPending, isError } = useQuery({
    queryKey: [...queryKeys.notifications, "page", tab],
    // Read and unread together: a lane you have already read is still the record of
    // what happened, and hiding it behind a second filter is what the old Unread /
    // All pair did — two ways of saying "recent" and no way of saying "mine to do".
    queryFn: () => fetchNotifications({ lane, limit: PAGE_SIZE }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
  };
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    onSuccess: refresh,
  });
  const archive = useMutation({ mutationFn: archiveNotification, onSuccess: refresh });

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="What is waiting on you, and what has happened around it."
        actions={
          <>
            <Button variant="ghost" onClick={() => markRead.mutate(undefined)}>
              <Check className="h-4 w-4" aria-hidden />
              Mark all read
            </Button>
            {/* The way to "stop sending me this", one click from the thing that
                prompted the thought. */}
            <Link to="/profile" search={{ tab: "notifications" }}>
              <Button variant="ghost">
                <Settings2 className="h-4 w-4" aria-hidden />
                Preferences
              </Button>
            </Link>
          </>
        }
      />

      <PageTabs
        tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
        active={tab}
        onSelect={(id: string) => setTab(id as TabId)}
      />

      <Card className="mt-4 p-0">
        {isError ? (
          <p className="p-6 text-sm text-muted-foreground">
            Your notifications could not be loaded.
          </p>
        ) : isPending ? (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        ) : data.items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {tab === "needs-you"
              ? "Nothing is waiting on you."
              : tab === "activity"
                ? "No activity to show."
                : "Nothing here yet."}
          </p>
        ) : (
          <ul>
            {data.items.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3 border-b border-border/60 p-4 last:border-0"
              >
                {!item.readAt ? (
                  <span className="brand-gradient mt-2 h-2 w-2 shrink-0 rounded-full" aria-hidden />
                ) : (
                  <span className="mt-2 h-2 w-2 shrink-0" aria-hidden />
                )}

                <div className="min-w-0 flex-1">
                  {item.link ? (
                    <Link
                      to={item.link}
                      onClick={() => {
                        if (!item.readAt) markRead.mutate([item.id]);
                      }}
                      className={cn(
                        "text-sm hover:underline",
                        item.readAt ? "text-muted-foreground" : "font-medium",
                      )}
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <p
                      className={cn(
                        "text-sm",
                        item.readAt ? "text-muted-foreground" : "font-medium",
                      )}
                    >
                      {item.title}
                    </p>
                  )}
                  {item.body ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(item.createdAt)}
                    {item.actorName ? ` · ${item.actorName}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {!item.readAt ? (
                    <button
                      type="button"
                      onClick={() => markRead.mutate([item.id])}
                      aria-label="Mark read"
                      title="Mark read"
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Check className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => archive.mutate(item.id)}
                    aria-label="Remove"
                    title="Remove"
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data && data.total > data.items.length ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Showing {data.items.length} of {data.total}. Older ones are removed once they have been
          read for a while.
        </p>
      ) : null}
    </div>
  );
}
