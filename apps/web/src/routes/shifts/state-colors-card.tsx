// Author: Brijesh Dave <https://github.com/brijeshdave>
// The calendar colours for a day off, leave and a public holiday.
//
// These three were hardcoded until now — which meant the codes people scan a month
// for hardest were the three nobody could change. They take the same palette as the
// shifts, so a month is one visual language rather than "shifts have colours and
// states have opinions".
//
// It sits on the Shifts screen rather than under Settings because this is a decision
// somebody makes while looking at their rota vocabulary, not while configuring a
// server — though the same setting is editable there too, since it is an ordinary
// company setting and the settings screen is generated from the registry.
import {
  SCHEDULE_STATE_COLORS,
  defaultFor,
  type ScheduleStateColors,
  type ShiftColor,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { ColorPicker } from "@/routes/shifts/color-picker.js";
import { SHIFT_COLOR_CLASSES } from "@/routes/shifts/shift-colors.js";
import { fetchCompanySettings, saveCompanySetting } from "@/services/settings.js";

const ROWS: { key: keyof ScheduleStateColors; code: string; label: string; hint: string }[] = [
  { key: "off", code: "W/O", label: "Day off", hint: "Most of a month. Best kept quiet." },
  { key: "leave", code: "L", label: "Leave", hint: "What a manager scans for." },
  { key: "holiday", code: "PH", label: "Public holiday", hint: "Everybody, one day." },
];

export function StateColorsCard({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const stored = useQuery({
    queryKey: ["settings", "company", companyId],
    queryFn: async (): Promise<ScheduleStateColors> => {
      const records = await fetchCompanySettings(companyId);
      const record = records.find(
        (r) =>
          r.namespace === SCHEDULE_STATE_COLORS.namespace && r.key === SCHEDULE_STATE_COLORS.key,
      );
      // A company that has never answered gets the shipped defaults, which is also
      // what the calendar is drawing — so the card opens showing the truth.
      return record
        ? SCHEDULE_STATE_COLORS.schema.parse(record.value)
        : defaultFor(SCHEDULE_STATE_COLORS);
    },
  });

  const [draft, setDraft] = useState<ScheduleStateColors>(() => defaultFor(SCHEDULE_STATE_COLORS));
  const [saved, setSaved] = useState(false);

  // Follow the server once it answers. Without this the card would open on the
  // defaults and then quietly save them over whatever the company had chosen.
  useEffect(() => {
    if (stored.data) setDraft(stored.data);
  }, [stored.data]);

  const save = useMutation({
    mutationFn: (value: ScheduleStateColors) =>
      saveCompanySetting(
        companyId,
        SCHEDULE_STATE_COLORS.namespace,
        SCHEDULE_STATE_COLORS.key,
        value,
      ),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["settings", "company", companyId] });
      // The grid reads these with the schedule, so its cached copy is now stale.
      await queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
  });

  const dirty = stored.data ? ROWS.some((row) => draft[row.key] !== stored.data![row.key]) : false;

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-sm font-semibold">Calendar colours</h2>
        <p className="text-xs text-muted-foreground">
          What a day off, a leave day and a public holiday look like on the schedule. The same
          palette as the shifts, so one month reads as one thing.
        </p>
      </div>

      {stored.error ? <ErrorAlert error={stored.error} /> : null}
      {save.error ? <ErrorAlert error={save.error} /> : null}
      {saved && !dirty ? <Alert tone="success">Calendar colours saved.</Alert> : null}

      {ROWS.map((row) => (
        <div key={row.key} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {/* The code in the colour it is about to be — the answer to "what will
                this look like?" is the control itself, not a description of it. */}
            <span
              className={cn(
                "min-w-[2.5rem] rounded px-1.5 py-0.5 text-center text-[13px] font-semibold",
                SHIFT_COLOR_CLASSES[draft[row.key]].cell,
              )}
            >
              {row.code}
            </span>
            <span className="text-sm font-medium">{row.label}</span>
            <span className="text-xs text-muted-foreground">{row.hint}</span>
          </div>
          <ColorPicker
            label={`${row.label} colour`}
            value={draft[row.key]}
            disabled={save.isPending}
            onChange={(color: ShiftColor) => {
              setSaved(false);
              setDraft((current) => ({ ...current, [row.key]: color }));
            }}
          />
        </div>
      ))}

      <div className="flex justify-end">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
          Save colours
        </Button>
      </div>
    </Card>
  );
}
