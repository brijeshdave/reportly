// Author: Brijesh Dave <https://github.com/brijeshdave>
// Assigning work, and editing what was assigned.
//
// The assignee list is your downline plus yourself — read from the same reporting
// line the server checks against, so the picker cannot offer somebody the API will
// refuse. It is a list of who works for you, not a list of everyone.
import { PERMISSIONS, type TaskPriority, type CreateTask } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { usePermission } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { SearchableSelect } from "@/components/searchable-select.js";
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
  const [assigneeId, setAssigneeId] = useState("");
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
    setAssigneeId(existing.data.assigneeId);
    setPriority(existing.data.priority);
    setDueAt(toLocalInput(existing.data.dueAt));
  }, [existing.data]);

  // Default to assigning it to yourself: the commonest case is noting your own job.
  useEffect(() => {
    if (mode === "create" && !assigneeId && me?.id) setAssigneeId(me.id);
  }, [mode, assigneeId, me?.id]);

  const save = useMutation({
    mutationFn: async () => {
      const body: CreateTask = {
        title: title.trim(),
        assigneeId,
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
            ? "Hand a job to yourself or to someone below you in the reporting line. When they complete it, a report opens pre-filled so the work gets logged."
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
                  : undefined
            }
          >
            {(props) =>
              // Without `tasks:create`, this person may only ever pick themselves.
              // A picker that lists names and then answers 403 is worse than no
              // picker: it offers a choice that was never on the table.
              mayAssign ? (
                <SearchableSelect
                  {...props}
                  value={assigneeId}
                  onChange={setAssigneeId}
                  options={people}
                  placeholder="Choose who does it"
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
          <Button
            onClick={() => save.mutate()}
            disabled={!title.trim() || !assigneeId || save.isPending}
          >
            {save.isPending ? <Spinner /> : null}
            {mode === "create" ? "Assign" : "Save"}
          </Button>
        </div>
      </Card>
    </>
  );
}
