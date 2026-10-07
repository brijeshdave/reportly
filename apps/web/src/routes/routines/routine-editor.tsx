// Author: Brijesh Dave <https://github.com/brijeshdave>
// Create or edit a routine: what it is, how often (cadence + anchor), what it's worth,
// and who on your team does it. Assignees are chosen from your reporting downline.
import {
  ROUTINE_CADENCES,
  ROUTINE_CADENCE_LABELS,
  createRoutineSchema,
  type CreateRoutine,
  type Routine,
  type RoutineCadence,
} from "@reportly/shared";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useForm } from "@/hooks/use-form.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { Field, Input, Select, Spinner } from "@/components/ui/form.js";
import { MultiSelect } from "@/components/multi-select.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDownline, fetchMyDepartments } from "@/services/departments.js";
import { fetchMyLocations } from "@/services/locations.js";
import { createRoutine, fetchRoutine, updateRoutine } from "@/services/routines.js";
import { dayOffset } from "@/routes/routines/util.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** What the form holds. Numbers stay as typed text; the payload builder converts. */
interface RoutineForm {
  departmentId: string;
  locationId: string;
  title: string;
  description: string;
  cadence: RoutineCadence;
  anchorWeekday: number;
  anchorDay: number;
  anchorMonthOfQuarter: number;
  points: string;
  startDate: string;
  graceDays: string;
  active: boolean;
  assigneeIds: string[];
}

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
    queryFn: () => fetchMyDepartments(),
  });
  // Only this company's. A routine is created against the active company, so a
  // department from another one is not a choice — the API rejects it, and it used
  // to sit in the list looking exactly like the one that works.
  const departments = (myDepartments.data ?? []).filter((d) => d.companyId === session.companyId);
  const deptOptions = departmentOptions(
    departments.map((d) => ({ value: d.departmentId, name: d.name, path: d.path })),
  );

  // The sites this person may file at — the same list the journal and task editors
  // offer, and the one the server checks, so the picker cannot name a site the save
  // would refuse.
  const sites = useQuery({ queryKey: ["locations", "mine"], queryFn: fetchMyLocations });

  // The route's own schema. The numbers are kept as the text the inputs hold and
  // converted on the way out, so a half-typed "1" is never read as NaN.
  const form = useForm<RoutineForm, CreateRoutine>({
    schema: createRoutineSchema,
    initial: {
      departmentId: routine?.departmentId ?? "",
      locationId: routine?.locationId ?? "",
      title: routine?.title ?? "",
      description: routine?.description ?? "",
      cadence: routine?.cadence ?? "daily",
      anchorWeekday: routine?.anchorWeekday ?? 1,
      anchorDay: routine?.anchorDay ?? 1,
      anchorMonthOfQuarter: routine?.anchorMonthOfQuarter ?? 1,
      points: String(routine?.points ?? 1),
      startDate: routine?.startDate ?? dayOffset(0),
      graceDays: String(routine?.graceDays ?? 3),
      active: (routine?.status ?? "active") === "active",
      assigneeIds: routine?.assignees.map((a) => a.userId) ?? [],
    },
    toPayload: (v) => ({
      departmentId: v.departmentId || departments[0]?.departmentId || "",
      locationId: v.locationId,
      title: v.title.trim(),
      description: v.description.trim() || undefined,
      cadence: v.cadence,
      // Only the anchor the chosen cadence uses. A weekday left over from a weekly
      // routine would otherwise travel with a monthly one and mean nothing.
      anchorWeekday: v.cadence === "weekly" ? v.anchorWeekday : null,
      anchorDay: v.cadence === "monthly" || v.cadence === "quarterly" ? v.anchorDay : null,
      anchorMonthOfQuarter: v.cadence === "quarterly" ? v.anchorMonthOfQuarter : null,
      points: Number(v.points) || 0,
      startDate: v.startDate,
      graceDays: Number(v.graceDays) || 0,
      status: v.active ? ("active" as const) : ("paused" as const),
      assigneeIds: v.assigneeIds,
    }),
    submit: (input) => (mode === "edit" ? updateRoutine(routine!.id, input) : createRoutine(input)),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["routines"] });
      await navigate({
        to: "/routines/manage/$routineId",
        params: { routineId: (saved as { id: string }).id },
      });
    },
  });
  const {
    departmentId,
    locationId,
    cadence,
    anchorWeekday,
    anchorDay,
    anchorMonthOfQuarter,
    active,
    assigneeIds,
  } = form.values;
  const effectiveDept = departmentId || departments[0]?.departmentId || "";

  // The manager may assign to themselves or anyone below them.
  // Searchable, with each person's department underneath: a downline of forty was a
  // checkbox list you had to scroll, and two people of the same name were two
  // identical rows.
  const options = [
    { value: session.user.id, label: `${session.user.name} (you)` },
    ...(downline.data ?? []).map((m) => ({
      value: m.userId,
      label: m.name,
      hint: [m.designation, m.departmentName].filter(Boolean).join(" · ") || undefined,
    })),
  ].filter((o, i, arr) => arr.findIndex((x) => x.value === o.value) === i);

  // Two rules the field schema cannot see: a routine needs somebody on it, and the
  // department falls back to this person's only one. Everything else is the schema's.
  const canSave = assigneeIds.length > 0 && effectiveDept !== "" && !form.submitting;

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
        <form {...form.formProps} className="flex flex-col gap-4">
          {form.formError ? <ErrorAlert error={form.formError} /> : null}

          <Field label="Title" required error={form.errorFor("title")}>
            {(props) => (
              <Input
                {...props}
                {...form.register("title")}
                autoFocus
                placeholder="e.g. Boiler pressure check"
              />
            )}
          </Field>
          <Field label="Description" error={form.errorFor("description")}>
            {(props) => (
              <textarea
                {...props}
                {...form.register("description")}
                rows={2}
                maxLength={2000}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              />
            )}
          </Field>

          <Field label="Department" hint="its points are credited here on the leaderboard">
            {() =>
              departments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You are in no department at this company.
                </p>
              ) : (
                <SearchableSelect
                  ariaLabel="Department"
                  name="departmentId"
                  value={effectiveDept}
                  onChange={(next) => form.set("departmentId", next)}
                  options={deptOptions}
                  placeholder="Pick a department"
                />
              )
            }
          </Field>

          <Field
            label="Site"
            required
            error={form.errorFor("locationId")}
            hint="where the duty is done"
          >
            {(props) => (
              <Select
                {...props}
                value={locationId}
                onChange={(e) => form.set("locationId", e.target.value)}
              >
                <option value="">Choose one</option>
                {(sites.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex flex-wrap gap-4">
            <div className="min-w-[10rem] flex-1">
              <Field label="Cadence" error={form.errorFor("cadence")}>
                {(props) => (
                  <Select
                    {...props}
                    value={cadence}
                    onChange={(e) => form.set("cadence", e.target.value as RoutineCadence)}
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
                      onChange={(e) => form.set("anchorWeekday", Number(e.target.value))}
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
                      onChange={(e) => form.set("anchorMonthOfQuarter", Number(e.target.value))}
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
                      onChange={(e) => form.set("anchorDay", Number(e.target.value))}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="w-28">
              <Field label="Points" error={form.errorFor("points")} hint="on-time; half if late">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    {...form.register("points")}
                  />
                )}
              </Field>
            </div>
            <div className="w-44">
              <Field label="Starts" required error={form.errorFor("startDate")}>
                {(props) => <Input {...props} type="date" {...form.register("startDate")} />}
              </Field>
            </div>
            <div className="w-32">
              <Field label="Grace days" error={form.errorFor("graceDays")} hint="then it expires">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    max={366}
                    {...form.register("graceDays")}
                  />
                )}
              </Field>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">Assign to</span>
            <MultiSelect
              ariaLabel="Assignees"
              options={options}
              values={assigneeIds}
              onChange={(next) => form.set("assigneeIds", next)}
              placeholder="Pick people…"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Any of them may complete each occurrence.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => form.set("active", e.target.checked)}
            />
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
              {form.submitting ? <Spinner /> : null}
              {mode === "edit" ? "Save changes" : "Create routine"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
