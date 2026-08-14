// Author: Brijesh Dave <https://github.com/brijeshdave>
// What you get told about, and where.
//
// A grid of types against channels. Two things it must not do, both of which
// produce a screen that lies:
//
//   - offer a box that cannot take effect. A channel the administrator has
//     withdrawn, or one you have not verified, is shown disabled with the reason,
//     not silently unticked — an unticked box says "you chose this".
//   - save on a click. The whole grid is edited and then saved, because changing
//     fourteen rows one request at a time makes a screen that flickers and a
//     network tab full of races.
import {
  type NotificationChannel,
  type NotificationPreferenceRow,
  type NotificationPreferences,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Alert, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card } from "@/components/ui/primitives.js";
import { queryKeys } from "@/lib/queries.js";
import {
  fetchNotificationPreferences,
  saveNotificationPreferences,
} from "@/services/notifications.js";

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  inapp: "In app",
  email: "Email",
  mobile: "SMS",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
};

const CATEGORY_LABEL: Record<string, string> = {
  journal: "Journal",
  tasks: "Tasks",
  shifts: "Shifts",
  routines: "Routines",
  downtime: "Downtime",
};

const key = (type: string, channel: string) => `${type}:${channel}`;

/** Every cell of the grid, flattened to what the API wants back. */
function toPayload(rows: NotificationPreferenceRow[], edits: Map<string, boolean>) {
  return rows.flatMap((row) =>
    row.cells
      .filter((cell) => cell.allowed)
      .map((cell) => ({
        type: row.type,
        channel: cell.channel,
        enabled: edits.get(key(row.type, cell.channel)) ?? cell.enabled,
      })),
  );
}

export function NotificationsTab() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: fetchNotificationPreferences,
  });

  // Edits held until Save. Keyed by type+channel so a re-fetch underneath does
  // not discard what somebody has been ticking.
  const [edits, setEdits] = useState<Map<string, boolean>>(new Map());
  const [saved, setSaved] = useState(false);

  useEffect(() => setSaved(false), [edits]);

  const save = useMutation({
    mutationFn: (payload: Parameters<typeof saveNotificationPreferences>[0]) =>
      saveNotificationPreferences(payload),
    onSuccess: (fresh: NotificationPreferences) => {
      queryClient.setQueryData(queryKeys.notificationPreferences, fresh);
      setEdits(new Map());
      setSaved(true);
    },
  });

  if (isPending) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  const dirty = edits.size > 0;
  const byCategory = new Map<string, NotificationPreferenceRow[]>();
  for (const row of data.rows) {
    byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
  }

  const toggle = (type: string, channel: NotificationChannel, next: boolean) => {
    setEdits((current) => new Map(current).set(key(type, channel), next));
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">
        Your administrator decides which channels each kind of notification may use. You can switch
        off anything you do not want. To use SMS, WhatsApp, Telegram or Discord you must first
        verify that channel under{" "}
        <Link to="/profile" search={{ tab: "channels" }}>
          Channels
        </Link>
        .
      </Alert>

      {[...byCategory.entries()].map(([category, rows]) => (
        <Card key={category} className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <caption className="px-4 pt-4 text-left text-sm font-semibold">
              {CATEGORY_LABEL[category] ?? category}
            </caption>
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                <th scope="col" className="w-full px-4 py-2 text-left font-medium">
                  Notification
                </th>
                {data.channels.map((channel) => (
                  <th
                    key={channel}
                    scope="col"
                    className="w-28 whitespace-nowrap px-3 py-2 text-center font-medium"
                  >
                    {CHANNEL_LABEL[channel]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.type} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="block font-medium">{row.label}</span>
                    <span className="block text-xs text-muted-foreground">{row.description}</span>
                  </th>
                  {row.cells.map((cell) => {
                    const checked = edits.get(key(row.type, cell.channel)) ?? cell.enabled;
                    const blocked = !cell.allowed || !cell.deliverable;
                    // The two reasons a box is closed are different problems with
                    // different fixes, so they get different sentences.
                    const why = !cell.allowed
                      ? "Your administrator does not send this on this channel"
                      : "Verify this channel under Channels first";
                    return (
                      <td key={cell.channel} className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={checked && !blocked}
                          disabled={blocked}
                          title={blocked ? why : undefined}
                          aria-label={`${row.label} — ${CHANNEL_LABEL[cell.channel]}${
                            blocked ? ` (unavailable: ${why})` : ""
                          }`}
                          onChange={(event) => toggle(row.type, cell.channel, event.target.checked)}
                          className="h-4 w-4 accent-primary disabled:opacity-30"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <div className="flex items-center gap-3">
        <Button
          onClick={() => save.mutate(toPayload(data.rows, edits))}
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? "Saving…" : "Save preferences"}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
        {save.error ? <ErrorAlert error={save.error} /> : null}
      </div>
    </div>
  );
}
