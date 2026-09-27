// Author: Brijesh Dave <https://github.com/brijeshdave>
// Assigning work, and editing what was assigned.
//
// The assignee list is your downline plus yourself — read from the same reporting
// line the server checks against, so the picker cannot offer somebody the API will
// refuse. It is a list of who works for you, not a list of everyone.
//
// Several people may be on one task, and none is allowed too: "allow to create the
// task without any assign to so that i can create task in advance for my team and
// only assign when i need to based on priority". A task with nobody on it stays on
// its creator's list and notifies no one until it is handed out.
import {
  PERMISSIONS,
  createTaskSchema,
  type CreateTask,
  type TaskPriority,
} from "@reportly/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { usePermission } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { MultiSelect } from "@/components/multi-select.js";
import { Field, Input, Select, Spinner, Textarea } from "@/components/ui/form.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { useForm } from "@/hooks/use-form.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDownline } from "@/services/departments.js";
import { fetchMyLocations } from "@/services/locations.js";
import { createTask, fetchTask, fetchTaskLimits, updateTask } from "@/services/tasks.js";

const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

/** What the form holds. Text as typed; the payload builder does the converting. */
interface TaskForm {
  title: string;
  detail: string;
  assigneeIds: string[];
  priority: TaskPriority;
  maxPoints: string;
  dueAt: string;
  locationId: string;
}

/** The request body this form's state becomes — the shape the schema judges. */
function bodyFrom(v: TaskForm) {
  return {
    title: v.title.trim(),
    assigneeIds: v.assigneeIds,
    priority: v.priority,
    maxPoints: Number(v.maxPoints) || 0,
    // An empty box is left empty rather than turned into `Invalid Date`: the schema's
    // message for a missing date reads better than its message for an unparseable one.
    dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : undefined,
    locationId: v.locationId || undefined,
    ...(v.detail.trim() ? { detail: v.detail.trim() } : {}),
  };
}

/** The latest a task of this priority may be due, as `datetime-local` wants it. */
function latestDue(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return toLocalInput(d.toISOString());
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`, not an ISO string with a zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskEditorPage({ mode, taskId }: { mode: "create" | "edit"; taskId?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQuery);
  const me = session?.user;
  // Which of the two grants brought them here: assigning down the line, or giving
  // themselves work and nobody else.
  const mayAssign = usePermission(PERMISSIONS.TASKS_CREATE);

  const form = useForm<TaskForm, CreateTask>({
    // The route's own schema. Its `locationId` is required now, like every other
    // kind of entry: a task with no site belongs to nobody's plant, falls out of
    // every per-site figure, and cannot be handed to whoever is actually there.
    schema: createTaskSchema,
    initial: {
      title: "",
      detail: "",
      assigneeIds: [] as string[],
      priority: "normal" as TaskPriority,
      maxPoints: "10",
      dueAt: "",
      locationId: "",
    },
    toPayload: (v) => bodyFrom(v),
    submit: async (payload: CreateTask) =>
      mode === "create"
        ? createTask(payload)
        : updateTask(taskId!, {
            ...payload,
            // Explicitly null, because the builder omits an empty detail and an
            // absent key leaves the stored one alone — so clearing it would not stick.
            detail: payload.detail ?? null,
          }),
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await navigate({ to: "/tasks/$taskId", params: { taskId: (task as { id: string }).id } });
    },
  });
  const values = form.values;
  const { priority } = values;

  // How far ahead this priority may be due. Read from the server, which checks the
  // same numbers on save, so the form cannot offer a date the save will refuse — and
  // the hint can say the number rather than "some limit applies".
  const limits = useQuery({ queryKey: ["tasks", "limits"], queryFn: fetchTaskLimits });
  const limitDays = limits.data ? limits.data.dueDays[priority] : null;
  const limited = limits.data?.dueLimitApplies !== false && limitDays !== null;

  // Sites this person may file at — the same list the journal editor offers, and the
  // same one the server checks, so the picker cannot name a site the save refuses.
  const locations = useQuery({ queryKey: ["locations", "mine"], queryFn: fetchMyLocations });

  // Who this person may hand work to: themselves, plus everyone below them.
  const downline = useQuery({
    queryKey: ["downline", me?.id],
    queryFn: () => fetchDownline(me!.id),
    enabled: Boolean(me?.id),
  });

  const existing = useQuery({
    queryKey: ["tasks", "detail", taskId],
    queryFn: () => fetchTask(taskId!),
    enabled: mode === "edit" && Boolean(taskId),
  });

  useEffect(() => {
    if (!existing.data) return;
    form.reset({
      title: existing.data.title,
      detail: existing.data.detail ?? "",
      // Only the people still on it: somebody who handed the task over stays on the
      // record for the points, but re-saving the form must not silently put them
      // back to work.
      assigneeIds: existing.data.assignees.filter((a) => !a.released).map((a) => a.id),
      priority: existing.data.priority,
      maxPoints: String(existing.data.maxPoints),
      dueAt: toLocalInput(existing.data.dueAt),
      locationId: existing.data.locationId ?? "",
    });
    // Deliberately keyed on the loaded record alone: re-seeding whenever the form
    // handle changed identity would wipe whatever the person had typed.
  }, [existing.data]);

  // Somebody who may only create their own work starts with themselves on it, since
  // that is the only answer available. Anybody assigning starts empty: they are
  // often planning ahead, and defaulting a manager onto their own team's task put
  // their name on work they were not going to do.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (mode !== "create" || seeded || !me?.id) return;
    setSeeded(true);
    if (!mayAssign) form.set("assigneeIds", [me.id]);
  }, [mode, seeded, me?.id, mayAssign]);

  if (mode === "edit" && existing.isLoading) return <Spinner />;

  // The name to choose by, and underneath it what tells two of the same name apart.
  // A downline of forty is forty entries to scroll past, and the name is the one
  // thing the person assigning already knows — so this list is searchable.
  const people = [
    ...(me ? [{ value: me.id, label: `${me.name} (you)` }] : []),
    ...(downline.data ?? []).map((d) => ({
      value: d.userId,
      label: d.name,
      hint: [d.designation, d.departmentName].filter(Boolean).join(" · ") || undefined,
    })),
  ];

  return (
    <>
      <PageHeader
        // The page says the same thing the button did: somebody who may only give
        // themselves work should not be told they can hand it down the line.
        title={mode === "create" ? (mayAssign ? "Assign a task" : "New task") : "Edit task"}
        description={
          mayAssign
            ? "Hand a job to yourself, or to one or more people below you in the reporting line — or to nobody yet, and give it out later. When it is completed, a report opens pre-filled so the work gets logged."
            : "Work you are giving yourself. When you complete it, an entry opens pre-filled, so it is logged and scored like any other."
        }
        actions={
          <Button size="sm" variant="secondary" onClick={() => void navigate({ to: "/tasks" })}>
            Back to tasks
          </Button>
        }
      />

      <Card className="mt-4">
        <form ref={form.formRef} onSubmit={form.handleSubmit} className="flex flex-col gap-4 p-6">
          {form.formError ? <ErrorAlert error={form.formError} /> : null}

          <Field label="Title" required error={form.errorFor("title")}>
            {(props) => (
              <Input
                {...props}
                {...form.register("title")}
                placeholder="e.g. Replace the drive belt on Line 3"
              />
            )}
          </Field>

          <Field
            label="Detail"
            hint="What needs doing, where the parts are — anything that saves a question later."
          >
            {(props) => <Textarea {...props} rows={4} {...form.register("detail")} />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Assign to"
              hint={
                !mayAssign
                  ? "Work you are giving yourself. Your manager assigns work to anybody else."
                  : people.length <= 1
                    ? "Nobody reports to you yet, so this is yours to do."
                    : "Leave it empty to plan the work now and hand it out later."
              }
            >
              {(props) =>
                // Without `tasks:create`, this person may only ever pick themselves.
                // A picker that lists names and then answers 403 is worse than no
                // picker: it offers a choice that was never on the table.
                mayAssign ? (
                  <MultiSelect
                    ariaLabel="Assign to"
                    options={people}
                    values={values.assigneeIds}
                    onChange={(next) => form.set("assigneeIds", next)}
                    placeholder="Nobody yet"
                  />
                ) : (
                  <Input {...props} value={me ? `${me.name} (you)` : "You"} readOnly />
                )
              }
            </Field>

            <Field label="Priority" error={form.errorFor("priority")}>
              {(props) => (
                <Select {...props} {...form.register("priority")}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Worth"
              hint="Points for the whole job, split between whoever does it. Your manager can change it."
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0"
                  step="0.5"
                  inputMode="decimal"
                  {...form.register("maxPoints")}
                />
              )}
            </Field>

            <Field
              label="Due"
              required
              error={form.errorFor("dueAt")}
              hint={
                limited
                  ? `Required. ${priority === "urgent" ? "An" : "A"} ${priority} task must be due within ${limitDays} ${limitDays === 1 ? "day" : "days"}.`
                  : "Required."
              }
            >
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  // The browser enforces the same ceiling the server does, so the
                  // limit is visible in the picker rather than discovered on save.
                  // Absent for somebody the rule exempts: a greyed-out date they are
                  // allowed to pick would be the form lying about the rule.
                  max={limited ? latestDue(limitDays) : undefined}
                  {...form.register("dueAt")}
                />
              )}
            </Field>

            <Field
              label="Site"
              required
              error={form.errorFor("locationId")}
              hint="Where the work is."
            >
              {(props) => (
                <Select {...props} {...form.register("locationId")}>
                  <option value="">Choose one</option>
                  {(locations.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="submit" disabled={form.submitting}>
              {form.submitting ? <Spinner /> : null}
              {mode === "create"
                ? values.assigneeIds.length > 0
                  ? "Assign"
                  : "Save for later"
                : "Save"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
