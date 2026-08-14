// Author: Brijesh Dave <https://github.com/brijeshdave>
// A task in full, and the hand-off that makes tasks worth having: **Complete & log
// work** marks it done and opens a report pre-filled from it, so the work lands in
// the appraisal loop instead of quietly ending at a tick-box.
//
// The state controls and the edit controls are split, because the permissions are:
// the person the task was given to moves it along; the person who gave it out edits
// and re-assigns. The server enforces both — this only avoids showing a button that
// would 403.
import { PERMISSIONS, type TaskState, formatDate } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, FileText } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { HistoryTab } from "@/components/history-tab.js";
import { Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { AttachmentsPanel } from "@/components/attachments-panel.js";
import { CommentsPanel } from "@/components/comments-panel.js";
import { deleteTask, fetchTask, updateTask } from "@/services/tasks.js";

const STATE_LABEL: Record<TaskState, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

const STATE_TONE = {
  open: "neutral",
  in_progress: "brand",
  done: "success",
  cancelled: "neutral",
} as const;

export function TaskDetailPage({ taskId }: { taskId: string }) {
  const { data: session } = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canDelete = usePermission(PERMISSIONS.TASKS_DELETE);
  const canWriteFiles = usePermission(PERMISSIONS.ATTACHMENTS_WRITE);

  const task = useQuery({
    queryKey: ["tasks", "detail", taskId],
    queryFn: () => fetchTask(taskId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tasks"] });

  const setState = useMutation({
    mutationFn: (state: TaskState) => updateTask(taskId, { state }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => deleteTask(taskId),
    onSuccess: async () => {
      await invalidate();
      await navigate({ to: "/tasks" });
    },
  });

  if (task.isLoading) return <Spinner />;
  if (task.error) return <ErrorAlert error={task.error} />;
  if (!task.data) return null;

  const t = task.data;
  const me = session?.user?.id;
  const isAssignee = me === t.assigneeId;
  const isAssigner = me === t.assignerId;
  // The server is the authority on this; the flag only avoids rendering a button
  // that would 403. tasks:delete is admin-only, so it stands in for "or an admin".
  const manages = isAssigner || canDelete;
  const closed = t.state === "done" || t.state === "cancelled";

  /** Mark it done, then go log the work. The report editor fetches the prefill. */
  const completeAndReport = async () => {
    await setState.mutateAsync("done");
    await navigate({ to: "/journal/new", search: { taskId } });
  };

  return (
    <>
      <PageHeader
        title={t.title}
        description={`Assigned to ${t.assigneeName} by ${t.assignerName}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={STATE_TONE[t.state]}>{STATE_LABEL[t.state]}</Badge>
            {manages && !closed ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void navigate({ to: "/tasks/$taskId/edit", params: { taskId } })}
              >
                Edit
              </Button>
            ) : null}
            {canDelete ? (
              <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 pt-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-sm font-semibold">What was asked</h2>
            {t.detail ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{t.detail}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No further detail.</p>
            )}
            <dl className="grid grid-cols-2 gap-3 pt-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Priority</dt>
                <dd>{t.priority}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Due</dt>
                <dd>{t.dueAt ? formatDate(t.dueAt) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Department</dt>
                <dd>{t.departmentName ?? "—"}</dd>
              </div>
            </dl>
          </Card>

          <HistoryTab entityType="tasks" id={taskId} />
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-sm font-semibold">Progress</h2>
            {setState.error ? <ErrorAlert error={setState.error} /> : null}

            {closed ? (
              <p className="text-sm text-muted-foreground">
                {t.state === "done"
                  ? `Completed${t.completedAt ? ` on ${formatDate(t.completedAt)}` : ""}.`
                  : "This task was cancelled."}
              </p>
            ) : isAssignee || manages ? (
              <div className="flex flex-col gap-2">
                {t.state === "open" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setState.mutate("in_progress")}
                    disabled={setState.isPending}
                  >
                    Start work
                  </Button>
                ) : null}

                {/* The whole point of the feature: finishing the job and recording
                    it are one action, so the work reaches the appraisal loop. */}
                {isAssignee ? (
                  <Button
                    size="sm"
                    onClick={() => void completeAndReport()}
                    disabled={setState.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Complete &amp; log work
                  </Button>
                ) : null}

                {manages ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setState.mutate("cancelled")}
                    disabled={setState.isPending}
                  >
                    Cancel this task
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Only {t.assigneeName} can move this task along.
              </p>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-6">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Work logged</h2>
            </div>
            {t.reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No report filed against this task yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {t.reports.map((r) => (
                  <li key={r.id}>
                    <Link
                      to="/journal/$reportId"
                      params={{ reportId: r.id }}
                      className="text-sm font-medium hover:underline"
                    >
                      {r.title}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">{r.state}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <AttachmentsPanel
            ownerType="task"
            ownerId={taskId}
            canWrite={canWriteFiles}
            locked={false}
          />

          <CommentsPanel ownerType="task" ownerId={taskId} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete "${t.title}"?`}
        description="The reports filed against it are kept — only the task itself goes."
        confirmLabel="Delete task"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}
