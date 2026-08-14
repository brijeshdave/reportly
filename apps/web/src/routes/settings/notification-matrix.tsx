// Author: Brijesh Dave <https://github.com/brijeshdave>
// The administrator's grid: which channels each kind of notification goes out on.
//
// This namespace opts out of the generated settings form, as `debug` does. The
// stored value is a record of fourteen types against six channels, and the
// generated renderer would draw it as a key/value list of comma-separated
// strings — technically editable, and unusable.
//
// The row an administrator sets here is both the default and the ceiling: users
// inherit it, and may switch things off within it but not add to it. So an
// unticked box means "nobody gets this on this channel", which is a stronger
// statement than the same box on the personal screen, and the caption says so.
import {
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationDeliverySettings,
  type NotificationMatrix,
  allowedChannelsFor,
} from "@reportly/shared";
import { useState } from "react";

import { Alert } from "@/components/ui/form.js";
import { Button, Card } from "@/components/ui/primitives.js";

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

const ALL_CHANNELS: NotificationChannel[] = [
  "inapp",
  "email",
  "mobile",
  "whatsapp",
  "telegram",
  "discord",
];

export function NotificationMatrixCard({
  matrix,
  delivery,
  disabled,
  onSave,
}: {
  matrix: NotificationMatrix;
  delivery: NotificationDeliverySettings;
  disabled: boolean;
  onSave: (next: NotificationMatrix) => Promise<unknown>;
}) {
  // Seeded from the effective value — the stored row where there is one, the
  // catalogue's defaults where there is not — so the grid shows what is actually
  // happening rather than a blank slate that is not the truth.
  const [draft, setDraft] = useState<Record<string, NotificationChannel[]>>(() =>
    Object.fromEntries(
      NOTIFICATION_TYPES.map((def) => [def.type, [...allowedChannelsFor(def.type, matrix)]]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const enabledChannels = ALL_CHANNELS.filter((channel) => {
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
  });

  const toggle = (type: string, channel: NotificationChannel) => {
    setSaved(false);
    setDraft((current) => {
      const row = current[type] ?? [];
      const next = row.includes(channel) ? row.filter((c) => c !== channel) : [...row, channel];
      return { ...current, [type]: next };
    });
  };

  const byCategory = new Map<string, typeof NOTIFICATION_TYPES>();
  for (const def of NOTIFICATION_TYPES) {
    byCategory.set(def.category, [...(byCategory.get(def.category) ?? []), def]);
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">
        A ticked channel is what a person receives unless they switch it off themselves. An unticked
        one is not offered to anybody. Channels switched off above do not appear here.
      </Alert>

      {[...byCategory.entries()].map(([category, defs]) => (
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
                {enabledChannels.map((channel) => (
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
              {defs.map((def) => (
                <tr key={def.type} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="block font-medium">{def.label}</span>
                    <span className="block text-xs text-muted-foreground">{def.description}</span>
                  </th>
                  {enabledChannels.map((channel) => (
                    <td key={channel} className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={(draft[def.type] ?? []).includes(channel)}
                        disabled={disabled}
                        aria-label={`${def.label} — ${CHANNEL_LABEL[channel]}`}
                        onChange={() => toggle(def.type, channel)}
                        className="h-4 w-4 accent-primary disabled:opacity-30"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <div className="flex items-center gap-3">
        <Button
          disabled={disabled || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(draft);
              setSaved(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save notification types"}
        </Button>
        {saved ? (
          <span className="text-sm text-muted-foreground">
            Saved. This changes what everyone receives who has not set their own preference.
          </span>
        ) : null}
      </div>
    </div>
  );
}
