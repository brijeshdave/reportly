// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating and editing a shift — a page, not a modal, like the rest of the app. Times
// are typed as HH:mm and stored as minutes from midnight; an end at or before the
// start is read as an overnight shift (e.g. 22:00–06:00), which is fine and called
// out so it never looks like a mistake.
import {
  PERMISSIONS,
  createShiftSchema,
  formatMinutesOfDay,
  parseMinutesOfDay,
  shiftDurationMinutes,
  type CreateShift,
  type Shift,
  type ShiftColor,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Can } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useForm } from "@/hooks/use-form.js";
import { useToast } from "@/components/toaster.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { ColorPicker } from "@/routes/shifts/color-picker.js";

/** Sunday first, matching the calendar header and `Date.getDay()`. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
import { createShift, deleteShift, fetchShift, updateShift } from "@/services/shifts.js";

/** What the form holds. Clock fields stay as `HH:mm`; the payload converts them. */
interface ShiftForm {
  name: string;
  code: string;
  color: ShiftColor;
  runsOnDays: number[];
  start: string;
  end: string;
  active: boolean;
}

export type ShiftEditorMode = "create" | "edit";

export function ShiftEditorPage({ mode, shiftId }: { mode: ShiftEditorMode; shiftId?: string }) {
  const source = useQuery({
    queryKey: ["shifts", "detail", shiftId],
    queryFn: () => fetchShift(shiftId as string),
    enabled: mode === "edit" && Boolean(shiftId),
  });

  if (mode === "edit" && source.isLoading) return <Spinner />;
  if (mode === "edit" && source.error) return <ErrorAlert error={source.error} />;

  return <Editor mode={mode} shift={source.data} />;
}

function Editor({ mode, shift }: { mode: ShiftEditorMode; shift?: Shift }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [confirmDelete, setConfirmDelete] = useState(false);

  // The route's own schema. The clock fields are kept as the `HH:mm` the input
  // speaks and converted on the way out — the API counts minutes from midnight, and
  // one place should know that.
  const form = useForm<ShiftForm, CreateShift>({
    schema: createShiftSchema,
    initial: {
      name: shift?.name ?? "",
      code: shift?.code ?? "",
      color: shift?.color ?? "blue",
      runsOnDays: shift?.runsOnDays ?? [0, 1, 2, 3, 4, 5, 6],
      start: formatMinutesOfDay(shift?.startMinute ?? 9 * 60),
      end: formatMinutesOfDay(shift?.endMinute ?? 17 * 60),
      active: (shift?.status ?? "active") === "active",
    },
    toPayload: (v) => ({
      name: v.name.trim(),
      code: v.code.trim().toUpperCase(),
      color: v.color,
      runsOnDays: v.runsOnDays,
      // `null` when the box is empty or half-typed. The schema's message for a
      // missing number reads better than one for `NaN`.
      startMinute: parseMinutesOfDay(v.start) ?? undefined,
      endMinute: parseMinutesOfDay(v.end) ?? undefined,
      status: v.active ? ("active" as const) : ("disabled" as const),
    }),
    submit: (input) => (mode === "edit" ? updateShift(shift!.id, input) : createShift(input)),
    onSuccess: (saved) => done(saved as Parameters<typeof done>[0]),
  });
  const { code, color, runsOnDays, start, end, active } = form.values;

  const startMinute = parseMinutesOfDay(start);
  const endMinute = parseMinutesOfDay(end);
  const bothValid = startMinute !== null && endMinute !== null;
  const zeroLength = bothValid && startMinute === endMinute;
  const overnight = bothValid && !zeroLength && endMinute <= startMinute;
  const durationLabel =
    bothValid && !zeroLength ? `${shiftDurationMinutes(startMinute, endMinute) / 60}h` : "";

  /** A deletion has nowhere to stay — the thing it was showing is gone. */
  const removed = async () => {
    await queryClient.invalidateQueries({ queryKey: ["shifts"] });
    toast.saved("Shift deleted.");
    await navigate({ to: "/shifts" });
  };

  const done = async (saved: { id: string; name: string }) => {
    await queryClient.invalidateQueries({ queryKey: ["shifts"] });
    toast.saved(mode === "edit" ? "Shift saved." : `${saved.name} created.`);
    // An edit stays where it is; a new one opens what was just created.
    if (mode !== "edit") {
      await navigate({ to: "/shifts/$shiftId/edit", params: { shiftId: saved.id } });
    }
  };

  const remove = useMutation({
    mutationFn: () => deleteShift(shift!.id),
    onSuccess: removed,
  });

  // The shape rules are the schema's now; this is the one the schema cannot express,
  // because a zero-length shift is only wrong once both ends are read together.
  const canSave = !zeroLength && !form.submitting;

  return (
    <>
      <PageHeader
        title={mode === "edit" ? "Edit shift" : "New shift"}
        description={
          mode === "edit"
            ? "Rename it, move its times, or disable it. Disabling retires it without touching the schedules that used it."
            : "A named span of the day a department can be scheduled on."
        }
        actions={
          <div className="flex items-center gap-2">
            {mode === "edit" ? (
              <Can permission={PERMISSIONS.SHIFTS_MANAGE}>
                <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </Can>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void navigate({ to: "/shifts" })}>
              Back
            </Button>
          </div>
        }
      />

      <Card className="mt-2 max-w-lg p-6">
        <form {...form.formProps} className="flex flex-col gap-4">
          {form.formError ? <ErrorAlert error={form.formError} /> : null}
          {remove.error ? <ErrorAlert error={remove.error} /> : null}

          <div className="flex gap-4">
            <div className="flex-1">
              <Field label="Name" required error={form.errorFor("name")}>
                {(props) => (
                  <Input
                    {...props}
                    {...form.register("name")}
                    autoFocus
                    disabled={form.submitting}
                    placeholder="e.g. Morning"
                  />
                )}
              </Field>
            </div>
            <div className="w-24">
              <Field label="Code" required error={form.errorFor("code")} hint="1–2 chars">
                {(props) => (
                  <Input
                    {...props}
                    name="code"
                    value={code}
                    onChange={(event) =>
                      form.set("code", event.target.value.toUpperCase().slice(0, 2))
                    }
                    maxLength={2}
                    disabled={form.submitting}
                    placeholder="e.g. G"
                    className="text-center uppercase"
                  />
                )}
              </Field>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium">Colour</span>
            <ColorPicker
              label="Shift colour"
              value={color}
              onChange={(next) => form.set("color", next)}
              disabled={form.submitting}
            />
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium">Runs on</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((label, index) => {
                const on = runsOnDays.includes(index);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    aria-label={label}
                    disabled={form.submitting}
                    onClick={() =>
                      // `form.set` takes a value, not an updater — the current list
                      // is right here, so there is nothing to thread through.
                      form.set(
                        "runsOnDays",
                        runsOnDays.includes(index)
                          ? runsOnDays.filter((day) => day !== index)
                          : [...runsOnDays, index].sort((a, b) => a - b),
                      )
                    }
                    className={cn(
                      "h-8 w-11 rounded-lg border text-xs font-medium transition",
                      on
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {label.slice(0, 2)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              The days this shift is expected to be staffed. A day left off is not counted as
              uncovered — which is what stops a general shift being reported missing every Sunday.
            </p>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <Field label="Starts" required error={form.errorFor("startMinute")}>
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    {...form.register("start")}
                    disabled={form.submitting}
                  />
                )}
              </Field>
            </div>
            <div className="flex-1">
              <Field
                label="Ends"
                hint={
                  durationLabel ? `${durationLabel}${overnight ? " · overnight" : ""}` : undefined
                }
              >
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    {...form.register("end")}
                    disabled={form.submitting}
                  />
                )}
              </Field>
            </div>
          </div>

          {zeroLength ? (
            <Alert tone="warning">A shift must start and end at different times.</Alert>
          ) : overnight ? (
            <Alert tone="info">
              This ends the next day — an overnight shift running past midnight.
            </Alert>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => form.set("active", event.target.checked)}
              disabled={form.submitting}
            />
            Available for scheduling
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/shifts" })}
              disabled={form.submitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {form.submitting ? <Spinner /> : null}
              {mode === "edit" ? "Save changes" : "Create shift"}
            </Button>
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${shift?.name}?`}
        description="Disabling a shift is usually better — it keeps the schedules that used it. Delete only if it was never used."
        confirmLabel="Delete shift"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}
