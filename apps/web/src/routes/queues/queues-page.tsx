// Author: Brijesh Dave <https://github.com/brijeshdave>
// The background queues: what is in each, and what is stuck.
//
// Reached only when the server runs with QUEUE_ADMIN set — the nav entry and the
// route both consult `session.queueAdmin`, because holding `queues:manage` on a
// `read` install means nothing: the route is not mounted.
//
// Counts move while you watch, so this polls. Redis being unreachable is a
// first-class state here rather than a spinner: every read on this page goes to
// Redis, and that is exactly the failure an operator opens the page to diagnose.
import {
  QUEUE_JOB_STATES,
  PERMISSIONS,
  type QueueJobState,
  type QueueSummary,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Pause, Play } from "lucide-react";
import { usePermission } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchQueues, setQueuePaused } from "@/services/queues.js";

/** Fast enough to be a monitor, slow enough to cost nothing while nobody looks. */
const POLL_MS = 5000;

export const STATE_LABEL: Record<QueueJobState, string> = {
  waiting: "Waiting",
  active: "Running",
  delayed: "Delayed",
  completed: "Completed",
  failed: "Failed",
};

export function QueuesPage() {
  const queryClient = useQueryClient();
  const { data: session } = useQuery(sessionQuery);
  const canManage = usePermission(PERMISSIONS.QUEUES_MANAGE) && session?.queueAdmin === "manage";

  const {
    data: queues,
    isPending,
    error,
  } = useQuery({
    queryKey: ["queues"],
    queryFn: fetchQueues,
    refetchInterval: POLL_MS,
  });

  const pause = useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) => setQueuePaused(id, paused),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["queues"] }),
  });

  return (
    <div>
      <PageHeader
        title="Queues"
        description="Background work: what is waiting, what is running, and what has failed."
        actions={session?.queueAdmin === "read" ? <Badge>Read only</Badge> : undefined}
      />

      {error ? <ErrorAlert error={error} /> : null}

      {isPending ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : (
        // A list of queues is a list. As a stack of anonymous divs a screen reader
        // never announced how many there were or where one ended, and nothing
        // could address a single queue's row except by counting.
        <ul className="flex flex-col gap-3">
          {(queues ?? []).map((queue) => (
            <li key={queue.id}>
              <QueueRow
                queue={queue}
                canManage={canManage}
                onTogglePause={() => pause.mutate({ id: queue.id, paused: !queue.paused })}
                busy={pause.isPending}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueRow({
  queue,
  canManage,
  onTogglePause,
  busy,
}: {
  queue: QueueSummary;
  canManage: boolean;
  onTogglePause: () => void;
  busy: boolean;
}) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link to="/queues/$queueId" params={{ queueId: queue.id }} className="hover:underline">
            <h2 className="text-sm font-semibold">{queue.label}</h2>
          </Link>
          {queue.paused ? <Badge tone="warning">Paused</Badge> : null}
          {queue.counts.failed > 0 ? (
            <Badge tone="danger">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {queue.counts.failed} failed
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{queue.description}</p>
      </div>

      <div className="flex items-center gap-4">
        <dl className="flex items-center gap-4 text-center">
          {QUEUE_JOB_STATES.map((state) => (
            <div key={state}>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {STATE_LABEL[state]}
              </dt>
              <dd
                className={cn(
                  "text-sm tabular-nums",
                  // Only failures are coloured. If every number were, none of
                  // them would mean anything.
                  state === "failed" && queue.counts[state] > 0
                    ? "font-semibold text-destructive"
                    : "text-foreground",
                )}
              >
                {queue.counts[state]}
              </dd>
            </div>
          ))}
        </dl>

        {canManage ? (
          <Button variant="ghost" onClick={onTogglePause} disabled={busy}>
            {queue.paused ? (
              <>
                <Play className="h-4 w-4" aria-hidden />
                Resume
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" aria-hidden />
                Pause
              </>
            )}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
