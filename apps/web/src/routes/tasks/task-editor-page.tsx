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
import { PERMISSIONS, type TaskPriority, type CreateTask } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { usePermission } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { MultiSelect } from "@/components/multi-select.js";
import { Field, Input, Select, Spinner, Textarea } from "@/components/ui/form.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchDownline } from "@/services/departments.js";
import { createTask, fetchTask, updateTask } from "@/services/tasks.js";

const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

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

  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [dueAt, setDueAt] = useState("");

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
    setTitle(existing.data.title);
    setDetail(existing.data.detail ?? "");
    // Only the people still on it: somebody who handed the task over stays on the
    // record for the points, but re-saving the form must not silently put them
    // back to work.
    setAssigneeIds(existing.data.assignees.filter((a) => !a.released).map((a) => a.id));
    setPriority(existing.data.priority);
    setDueAt(toLocalInput(existing.data.dueAt));
  }, [existing.data]);

  // Somebody who may only create their own work starts with themselves on it, since
  // that is the only answer available. Anybody assigning starts empty: they are
  // often planning ahead, and defaulting a manager onto their own team's task put
  // their name on work they were not going to do.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (mode !== "create" || seeded || !me?.id) return;
    setSeeded(true);
    if (!mayAssign) setAssigneeIds([me.id]);
  }, [mode, seeded, me?.id, mayAssign]);

  const save = useMutation({
    mutationFn: async () => {
      const body: CreateTask = {
        title: title.trim(),
        assigneeIds,
        priority,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      };
      return mode === "create"
        ? createTask(body)
        : updateTask(taskId!, {
            ...body,
            detail: detail.trim() || null,
            dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          });
    },
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      await navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
    },
  });

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

      <Card className="mt-4 flex flex-col gap-4 p-6">
        {save.error ? <ErrorAlert error={save.error} /> : null}

        <Field label="Title">
          {(props) => (
            <Input
              {...props}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Replace the drive belt on Line 3"
            />
          )}
        </Field>

        <Field
          label="Detail"
          hint="What needs doing, where the parts are — anything that saves a question later."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          )}
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
                  values={assigneeIds}
                  onChange={setAssigneeIds}
                  placeholder="Nobody yet"
                />
              ) : (
                <Input {...props} value={me ? `${me.name} (you)` : "You"} readOnly />
              )
            }
          </Field>

          <Field label="Priority">
            {(props) => (
              <Select
                {...props}
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Due" hint="Optional.">
            {(props) => (
              <Input
                {...props}
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending}>
            {save.isPending ? <Spinner /> : null}
            {mode === "create" ? (assigneeIds.length > 0 ? "Assign" : "Save for later") : "Save"}
          </Button>
        </div>
      </Card>
    </>
  );
}
