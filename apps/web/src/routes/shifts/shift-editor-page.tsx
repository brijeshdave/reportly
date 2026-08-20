// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating and editing a shift — a page, not a modal, like the rest of the app. Times
// are typed as HH:mm and stored as minutes from midnight; an end at or before the
// start is read as an overnight shift (e.g. 22:00–06:00), which is fine and called
// out so it never looks like a mistake.
import {
  PERMISSIONS,
  SHIFT_COLORS,
  formatMinutesOfDay,
  parseMinutesOfDay,
  shiftDurationMinutes,
  type Shift,
  type ShiftColor,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Can } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useToast } from "@/components/toaster.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { SHIFT_COLOR_CLASSES } from "@/routes/shifts/shift-colors.js";
import { createShift, deleteShift, fetchShift, updateShift } from "@/services/shifts.js";

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

  const [name, setName] = useState(shift?.name ?? "");
  const [code, setCode] = useState(shift?.code ?? "");
  const [color, setColor] = useState<ShiftColor>(shift?.color ?? "blue");
  const [start, setStart] = useState(formatMinutesOfDay(shift?.startMinute ?? 9 * 60));
  const [end, setEnd] = useState(formatMinutesOfDay(shift?.endMinute ?? 17 * 60));
  const [active, setActive] = useState((shift?.status ?? "active") === "active");
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        color,
        startMinute: startMinute!,
        endMinute: endMinute!,
        status: active ? ("active" as const) : ("disabled" as const),
      };
      return mode === "edit" ? updateShift(shift!.id, input) : createShift(input);
    },
    onSuccess: done,
  });

  const remove = useMutation({
    mutationFn: () => deleteShift(shift!.id),
    onSuccess: removed,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const canSave =
    name.trim() !== "" && code.trim() !== "" && bothValid && !zeroLength && !save.isPending;

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
        <form onSubmit={submit} className="flex flex-col gap-4">
          {save.error ? <ErrorAlert error={save.error} /> : null}
          {remove.error ? <ErrorAlert error={remove.error} /> : null}

          <div className="flex gap-4">
            <div className="flex-1">
              <Field label="Name">
                {(props) => (
                  <Input
                    {...props}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    autoFocus
                    disabled={save.isPending}
                    placeholder="e.g. Morning"
                  />
                )}
              </Field>
            </div>
            <div className="w-24">
              <Field label="Code" hint="1–2 chars">
                {(props) => (
                  <Input
                    {...props}
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 2))}
                    maxLength={2}
                    required
                    disabled={save.isPending}
                    placeholder="e.g. G"
                    className="text-center uppercase"
                  />
                )}
              </Field>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium">Colour</span>
            <div className="flex flex-wrap gap-1.5">
              {SHIFT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={color === c}
                  disabled={save.isPending}
                  onClick={() => setColor(c)}
                  className={cn(
                    "h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition",
                    SHIFT_COLOR_CLASSES[c].swatch,
                    color === c ? "ring-2 ring-foreground" : "hover:scale-110",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <Field label="Starts">
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                    disabled={save.isPending}
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
                    value={end}
                    onChange={(event) => setEnd(event.target.value)}
                    disabled={save.isPending}
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
              onChange={(event) => setActive(event.target.checked)}
              disabled={save.isPending}
            />
            Available for scheduling
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/shifts" })}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {save.isPending ? <Spinner /> : null}
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
