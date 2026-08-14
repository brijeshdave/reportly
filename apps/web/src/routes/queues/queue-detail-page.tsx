// Author: Brijesh Dave <https://github.com/brijeshdave>
// One queue: its jobs by state, its repeatable schedules, and the actions.
//
// The job panel shows a payload only when the API sends one — and the API omits
// it entirely without `queues:inspect`. The screen never has the data to hide, so
// there is nothing here to get wrong.
import {
  QUEUE_JOB_STATES,
  PERMISSIONS,
  formatDateTime,
  type QueueJobState,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, RotateCcw, Trash2, Zap } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { PageTabs } from "@/components/page-tabs.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Card, PageHeader } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { sessionQuery } from "@/lib/queries.js";
import { STATE_LABEL } from "@/routes/queues/queues-page.js";
import {
  fetchQueue,
  fetchQueueJob,
  fetchQueueJobs,
  promoteQueueJob,
  removeQueueJob,
  retryQueueJob,
} from "@/services/queues.js";

const POLL_MS = 5000;

export function QueueDetailPage({ queueId }: { queueId: string }) {
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQuery);
  const canManage = usePermission(PERMISSIONS.QUEUES_MANAGE) && session?.queueAdmin === "manage";

  const [state, setState] = useState<QueueJobState>("failed");
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["queues", queueId],
    queryFn: () => fetchQueue(queueId),
    refetchInterval: POLL_MS,
  });

  const jobs = useQuery({
    queryKey: ["queues", queueId, "jobs", state],
    queryFn: () => fetchQueueJobs(queueId, { state, limit: 50 }),
    refetchInterval: POLL_MS,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["queues"] });
  const retry = useMutation({
    mutationFn: (id: string) => retryQueueJob(queueId, id),
    onSuccess: refresh,
  });
  const promote = useMutation({
    mutationFn: (id: string) => promoteQueueJob(queueId, id),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeQueueJob(queueId, id),
    onSuccess: () => {
      setOpenJobId(null);
      void refresh();
    },
  });

  return (
    <div>
      <Link
        to="/queues"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All queues
      </Link>

      <PageHeader
        title={queue.data?.label ?? queueId}
        description={queue.data?.description}
        actions={queue.data?.paused ? <Badge tone="warning">Paused</Badge> : undefined}
      />

      {queue.error ? <ErrorAlert error={queue.error} /> : null}
      {retry.error ? <ErrorAlert error={retry.error} /> : null}
      {promote.error ? <ErrorAlert error={promote.error} /> : null}
      {remove.error ? <ErrorAlert error={remove.error} /> : null}

      {(queue.data?.schedulers.length ?? 0) > 0 ? (
        <Card className="mb-4 p-4">
          <h2 className="text-sm font-semibold">Repeating</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {queue.data!.schedulers.map((scheduler) => (
              <li key={scheduler.key} className="flex flex-wrap gap-x-4 text-sm">
                <span className="font-medium">{scheduler.name ?? scheduler.key}</span>
                <span className="text-muted-foreground">
                  {scheduler.pattern
                    ? scheduler.pattern
                    : scheduler.every
                      ? `every ${Math.round(scheduler.every / 60000)} min`
                      : "—"}
                </span>
                {scheduler.next ? (
                  <span className="text-muted-foreground">
                    next {formatDateTime(scheduler.next)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <PageTabs
        tabs={QUEUE_JOB_STATES.map((candidate) => ({
          id: candidate,
          // The count in the tab, so somebody scanning the page does not have to
          // click each state to find where the work is piled up.
          label: `${STATE_LABEL[candidate]} (${queue.data?.counts[candidate] ?? 0})`,
        }))}
        active={state}
        onSelect={(id: string) => {
          setState(id as QueueJobState);
          setOpenJobId(null);
        }}
      />

      <Card className="mt-4 p-0">
        {jobs.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner />
          </div>
        ) : jobs.error ? (
          <ErrorAlert error={jobs.error} />
        ) : jobs.data.items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Nothing {STATE_LABEL[state].toLowerCase()}.
          </p>
        ) : (
          <ul>
            {jobs.data.items.map((job) => (
              <li key={job.id} className="border-b border-border/60 last:border-0">
                <div className="flex items-start gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => setOpenJobId(openJobId === job.id ? null : job.id)}
                    aria-expanded={openJobId === job.id}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <ChevronRight
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        openJobId === job.id && "rotate-90",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {job.name}
                        <span className="ml-2 font-normal text-muted-foreground">#{job.id}</span>
                      </span>
                      {job.failedReason ? (
                        <span className="mt-0.5 block truncate text-xs text-destructive">
                          {job.failedReason}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatDateTime(job.createdAt)}
                        {job.attemptsMade > 0 ? ` · ${job.attemptsMade} attempt(s)` : ""}
                        {job.requestId ? ` · request ${job.requestId}` : ""}
                      </span>
                    </span>
                  </button>

                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {state === "failed" ? (
                        <button
                          type="button"
                          onClick={() => retry.mutate(job.id)}
                          aria-label="Retry"
                          title="Retry"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                      {state === "delayed" ? (
                        <button
                          type="button"
                          onClick={() => promote.mutate(job.id)}
                          aria-label="Run now"
                          title="Run now"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Zap className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                      {/* Never offered while running: BullMQ would drop the record
                          with the handler still going, leaving work nothing tracks. */}
                      {state !== "active" ? (
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(job.id)}
                          aria-label="Remove"
                          title="Remove"
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {openJobId === job.id ? <JobPanel queueId={queueId} jobId={job.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {jobs.data && jobs.data.total > jobs.data.items.length ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Showing {jobs.data.items.length} of {jobs.data.total}.
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove this job?"
        description="It is deleted from the queue. If it was still waiting, the work it carried never happens and there is no record that it was dropped."
        confirmLabel="Remove"
        destructive
        onClose={() => setConfirmRemove(null)}
        onConfirm={async () => {
          if (confirmRemove) await remove.mutateAsync(confirmRemove);
          setConfirmRemove(null);
        }}
      />
    </div>
  );
}

/** The expanded job: stack trace, and the payload when the API sent one. */
function JobPanel({ queueId, jobId }: { queueId: string; jobId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["queues", queueId, "job", jobId],
    queryFn: () => fetchQueueJob(queueId, jobId),
  });

  if (isPending)
    return (
      <div className="px-4 pb-4">
        <Spinner />
      </div>
    );
  if (error)
    return (
      <div className="px-4 pb-4">
        <ErrorAlert error={error} />
      </div>
    );

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/40 px-4 py-3">
      {data.stacktrace.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stack trace
          </h3>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-xs">
            {data.stacktrace.join("\n")}
          </pre>
        </div>
      ) : null}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Payload
        </h3>
        {"data" in data ? (
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(data.data, null, 2)}
          </pre>
        ) : (
          // Said, not silently omitted. A blank space here reads as "this job has
          // no payload", which is a different and wrong statement.
          <p className="mt-1 text-xs text-muted-foreground">
            Hidden. A job&rsquo;s contents can include other people&rsquo;s messages and addresses,
            so reading them needs the <code>queues:inspect</code> permission.
          </p>
        )}
      </div>
    </div>
  );
}
