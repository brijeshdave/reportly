// Author: Brijesh Dave <https://github.com/brijeshdave>
// Create or edit a routine: what it is, how often (cadence + anchor), what it's worth,
// and who on your team does it. Assignees are chosen from your reporting downline.
import {
  ROUTINE_CADENCES,
  ROUTINE_CADENCE_LABELS,
  type CreateRoutine,
  type Routine,
  type RoutineCadence,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Field, Input, Select, Spinner } from "@/components/ui/form.js";
import { MultiSelect } from "@/components/ui/multi-select.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDownline, fetchUserDepartments } from "@/services/departments.js";
import { createRoutine, fetchRoutine, updateRoutine } from "@/services/routines.js";
import { dayOffset } from "@/routes/routines/util.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RoutineEditorPage({
  mode,
  routineId,
}: {
  mode: "create" | "edit";
  routineId?: string;
}) {
  const source = useQuery({
    queryKey: ["routines", "detail", routineId],
    queryFn: () => fetchRoutine(routineId as string),
    enabled: mode === "edit" && Boolean(routineId),
  });
  if (mode === "edit" && source.isLoading) return <Spinner />;
  if (mode === "edit" && source.error) return <ErrorAlert error={source.error} />;
  return <Editor mode={mode} routine={source.data} />;
}

function Editor({ mode, routine }: { mode: "create" | "edit"; routine?: Routine }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const downline = useQuery({
    queryKey: ["users", "downline", session.user.id],
    queryFn: () => fetchDownline(session.user.id),
  });
  const myDepartments = useQuery({
    queryKey: ["users", "departments", session.user.id],
    queryFn: () => fetchUserDepartments(session.user.id),
  });
  const departments = myDepartments.data ?? [];

  const [departmentId, setDepartmentId] = useState(routine?.departmentId ?? "");
  const effectiveDept = departmentId || departments[0]?.departmentId || "";
  const [title, setTitle] = useState(routine?.title ?? "");
  const [description, setDescription] = useState(routine?.description ?? "");
  const [cadence, setCadence] = useState<RoutineCadence>(routine?.cadence ?? "daily");
  const [anchorWeekday, setAnchorWeekday] = useState(routine?.anchorWeekday ?? 1);
  const [anchorDay, setAnchorDay] = useState(routine?.anchorDay ?? 1);
  const [anchorMonthOfQuarter, setAnchorMonthOfQuarter] = useState(
    routine?.anchorMonthOfQuarter ?? 1,
  );
  const [points, setPoints] = useState(String(routine?.points ?? 1));
  const [startDate, setStartDate] = useState(routine?.startDate ?? dayOffset(0));
  const [graceDays, setGraceDays] = useState(String(routine?.graceDays ?? 3));
  const [active, setActive] = useState((routine?.status ?? "active") === "active");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    routine?.assignees.map((a) => a.userId) ?? [],
  );

  // The manager may assign to themselves or anyone below them.
  const options = [
    { value: session.user.id, label: `${session.user.name} (you)` },
    ...(downline.data ?? []).map((m) => ({ value: m.userId, label: m.name })),
  ].filter((o, i, arr) => arr.findIndex((x) => x.value === o.value) === i);

  const save = useMutation({
    mutationFn: () => {
      const input: CreateRoutine = {
        departmentId: effectiveDept,
        title: title.trim(),
        description: description.trim() || undefined,
        cadence,
        anchorWeekday: cadence === "weekly" ? anchorWeekday : null,
        anchorDay: cadence === "monthly" || cadence === "quarterly" ? anchorDay : null,
        anchorMonthOfQuarter: cadence === "quarterly" ? anchorMonthOfQuarter : null,
        points: Number(points) || 0,
        startDate,
        graceDays: Number(graceDays) || 0,
        status: active ? "active" : "paused",
        assigneeIds,
      };
      return mode === "edit" ? updateRoutine(routine!.id, input) : createRoutine(input);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["routines"] });
      await navigate({ to: "/routines/manage/$routineId", params: { routineId: saved.id } });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const canSave =
    title.trim() !== "" && effectiveDept !== "" && assigneeIds.length > 0 && !save.isPending;

  return (
    <>
      <PageHeader
        title={mode === "edit" ? "Edit routine" : "New routine"}
        description="A recurring duty for your team, worth points when done on time."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void navigate({ to: "/routines/manage" })}
          >
            Back
          </Button>
        }
      />
      <Card className="mt-2 max-w-xl p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {save.error ? <ErrorAlert error={save.error} /> : null}

          <Field label="Title">
            {(props) => (
              <Input
                {...props}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
                placeholder="e.g. Boiler pressure check"
              />
            )}
          </Field>
          <Field label="Description">
            {(props) => (
              <textarea
                {...props}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              />
            )}
          </Field>

          <Field label="Department" hint="its points are credited here on the leaderboard">
            {(props) => (
              <Select
                {...props}
                value={effectiveDept}
                onChange={(e) => setDepartmentId(e.target.value)}
                required
              >
                {departments.length === 0 ? (
                  <option value="">You are in no department</option>
                ) : null}
                {departments.map((d) => (
                  <option key={d.departmentId} value={d.departmentId}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex flex-wrap gap-4">
            <div className="min-w-[10rem] flex-1">
              <Field label="Cadence">
                {(props) => (
                  <Select
                    {...props}
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value as RoutineCadence)}
                  >
                    {ROUTINE_CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {ROUTINE_CADENCE_LABELS[c]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            {cadence === "weekly" ? (
              <div className="min-w-[9rem] flex-1">
                <Field label="On">
                  {(props) => (
                    <Select
                      {...props}
                      value={String(anchorWeekday)}
                      onChange={(e) => setAnchorWeekday(Number(e.target.value))}
                    >
                      {WEEKDAYS.map((w, i) => (
                        <option key={w} value={i}>
                          {w}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            ) : null}
            {cadence === "quarterly" ? (
              <div className="min-w-[9rem] flex-1">
                <Field label="Month of quarter">
                  {(props) => (
                    <Select
                      {...props}
                      value={String(anchorMonthOfQuarter)}
                      onChange={(e) => setAnchorMonthOfQuarter(Number(e.target.value))}
                    >
                      <option value="1">First</option>
                      <option value="2">Second</option>
                      <option value="3">Third</option>
                    </Select>
                  )}
                </Field>
              </div>
            ) : null}
            {cadence === "monthly" || cadence === "quarterly" ? (
              <div className="w-28">
                <Field label="Day">
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={1}
                      max={28}
                      value={anchorDay}
                      onChange={(e) => setAnchorDay(Number(e.target.value))}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="w-28">
              <Field label="Points" hint="on-time; half if late">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="w-44">
              <Field label="Starts">
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="w-32">
              <Field label="Grace days" hint="then it expires">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    max={366}
                    value={graceDays}
                    onChange={(e) => setGraceDays(e.target.value)}
                  />
                )}
              </Field>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">Assign to</span>
            <MultiSelect
              label="Assignees"
              options={options}
              selected={assigneeIds}
              onChange={setAssigneeIds}
              emptyLabel="Pick people…"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Any of them may complete each occurrence.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (paused routines stop generating occurrences)
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/routines/manage" })}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {save.isPending ? <Spinner /> : null}
              {mode === "edit" ? "Save changes" : "Create routine"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
