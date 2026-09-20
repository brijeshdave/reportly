// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reviews, in both directions.
//
// It began as a manager's queue alone: entries in their downline awaiting a score,
// and the tasks they handed out that are not finished. But the person who FILED
// the work had no way to see it sitting there waiting — the only way to find out
// whether anybody had looked at it was to ask. So the page now opens on your own
// entries and who they are with, and the manager's two lists sit beside it for
// whoever can appraise. That is also why it is `journal:read` rather than
// `journal:appraise`: the people who most need the first half are exactly the
// ones who could not reach the page at all.
import {
  PERMISSIONS,
  isMineToScore,
  type AwaitingReview,
  type PendingAppraisal,
  type TaskRow,
  formatDate,
} from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ClipboardCheck,
  Hourglass,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

import { usePermission } from "@/components/can.js";
import { KindBadge, SeverityBadge } from "@/components/report-badges.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import type { JournalView, TaskView } from "@/lib/list-views.js";
import { fetchAwaitingReview, fetchPending } from "@/services/journal.js";
import { fetchAssignedOpenTasks } from "@/services/tasks.js";

const TASK_STATE_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export function ReviewPage() {
  const canReadTasks = usePermission(PERMISSIONS.TASKS_READ);
  // Appraising is what fills the two manager lists. Somebody without it still
  // belongs on this page — their own work waiting on somebody else is the half
  // that was missing, and they are exactly who could not see it.
  const canAppraise = usePermission(PERMISSIONS.JOURNAL_APPRAISE);

  const pending = useQuery({
    queryKey: ["journal", "pending"],
    queryFn: fetchPending,
    enabled: canAppraise,
  });
  const mine = useQuery({ queryKey: ["journal", "awaiting-review"], queryFn: fetchAwaitingReview });

  /**
   * Two different jobs, split by depth.
   *
   * A head of department saw every entry from every level in one list — reported as
   * "it shows all entries of my full nested downline team, but it should only show
   * the entries of my direct reporting team". Depth 1 is theirs to score; anything
   * deeper is somebody else's to score and theirs to chase, which is a different
   * action and belongs under a different heading.
   */
  const direct = (pending.data ?? []).filter(isMineToScore);
  const deeper = (pending.data ?? []).filter((entry: PendingAppraisal) => !isMineToScore(entry));
  const tasks = useQuery({
    queryKey: ["tasks", "assigned-open"],
    queryFn: fetchAssignedOpenTasks,
    enabled: canReadTasks,
  });

  return (
    <>
      <PageHeader
        title="Reviews"
        description={
          canAppraise
            ? "What is waiting on you — entries to score and work you handed out — and what of yours is waiting on somebody else."
            : "What of your work is still waiting to be scored, and who it is waiting on."
        }
      />

      <div className="grid gap-4 pt-4 lg:grid-cols-2">
        {/* Your own, first for somebody who cannot appraise: it is the only card
            they have, and it answers the question they came with — has my work
            been looked at yet, and by whom. */}
        {/* Each section scrolls inside itself: four queues share this page, and a
            long one in any of them used to push the other three off the screen. */}
        <Card className="flex flex-col gap-3 p-6">
          <SectionHeading
            icon={Hourglass}
            title="Your entries waiting to be scored"
            count={mine.data?.length}
            readAll={{ to: "/journal", search: { view: "mine-waiting" } }}
          />

          {mine.isLoading ? <Spinner /> : null}
          {mine.error ? <ErrorAlert error={mine.error} /> : null}
          {mine.data && mine.data.length === 0 ? (
            <EmptyState
              icon={Hourglass}
              title="Nothing waiting"
              description="Everything you have filed and finished has been scored."
            />
          ) : null}

          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {(mine.data ?? []).map((entry: AwaitingReview) => (
              <li key={entry.reportId}>
                <Link
                  to="/journal/$reportId"
                  params={{ reportId: entry.reportId }}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{entry.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {/* Named, so it is a person to go and ask rather than
                          "somebody". No manager set is said outright — it means
                          nobody is going to score this until one is. */}
                      {/* It may not be waiting on anybody else at all: the self
                          split comes first, and until it exists there is nothing
                          for a manager to review. Saying "with Asha" then would
                          send somebody to chase work they are holding themselves. */}
                      {entry.needsSelfScore
                        ? "waiting on you — split the points first"
                        : entry.reviewerName
                          ? `with ${entry.reviewerName}`
                          : "no manager set on your reporting line"}
                      {entry.submittedAt ? ` · filed ${formatDate(entry.submittedAt)}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {entry.needsSelfScore ? <Badge tone="warning">your turn</Badge> : null}
                    {entry.severityName ? <SeverityBadge name={entry.severityName} /> : null}
                    <KindBadge kind={entry.kind} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {canAppraise ? (
          <Card className="flex flex-col gap-3 p-6">
            <SectionHeading
              icon={ClipboardCheck}
              title="Journal entries awaiting your review"
              count={direct.length}
              readAll={{ to: "/journal", search: { view: "direct-waiting" } }}
            />

            {pending.isLoading ? <Spinner /> : null}
            {pending.error ? <ErrorAlert error={pending.error} /> : null}
            {pending.data && direct.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title="All caught up"
                description="Nothing from your direct team is waiting to be scored."
              />
            ) : null}

            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {direct.map((entry: PendingAppraisal) => (
                <li key={entry.reportId}>
                  <Link
                    to="/journal/$reportId"
                    params={{ reportId: entry.reportId }}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{entry.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.authorName}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {entry.severityName ? <SeverityBadge name={entry.severityName} /> : null}
                      <KindBadge kind={entry.kind} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {canAppraise && deeper.length > 0 ? (
          <Card className="flex flex-col gap-3 p-6">
            <SectionHeading
              icon={ClipboardCheck}
              title="Waiting on your managers"
              count={deeper.length}
              tone="warning"
              readAll={{ to: "/journal", search: { view: "deeper-waiting" } }}
            />
            {/* Not yours to score — theirs. Shown because only points that a manager
                has reviewed count for anything, so an entry sitting unscored two
                levels down is somebody's work quietly earning nothing, and the only
                person who can see the whole picture is above them. */}
            <p className="text-xs text-muted-foreground">
              Further down your reporting line, and nobody has scored them yet. Points only count
              once a manager reviews, so these are earning nothing in the meantime.
            </p>

            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {deeper.map((entry: PendingAppraisal) => (
                <li key={entry.reportId}>
                  <Link
                    to="/journal/$reportId"
                    params={{ reportId: entry.reportId }}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{entry.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {entry.authorName} · {entry.depth} levels down
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {entry.severityName ? <SeverityBadge name={entry.severityName} /> : null}
                      <KindBadge kind={entry.kind} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {canAppraise && canReadTasks ? (
          <Card className="flex flex-col gap-3 p-6">
            <SectionHeading
              icon={ListChecks}
              title="Tasks you assigned, still open"
              count={tasks.data?.length}
              readAll={{ to: "/tasks", search: { view: "assigned-open" } }}
            />

            {tasks.isLoading ? <Spinner /> : null}
            {tasks.error ? <ErrorAlert error={tasks.error} /> : null}
            {tasks.data && tasks.data.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="Nothing outstanding"
                description="Every task you handed out is done."
              />
            ) : null}

            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {(tasks.data ?? []).map((task: TaskRow) => {
                const overdue = task.dueAt !== null && new Date(task.dueAt).getTime() < Date.now();
                return (
                  <li key={task.id}>
                    <Link
                      to="/tasks/$taskId"
                      params={{ taskId: task.id }}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{task.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {task.assignees
                            .filter((person) => !person.released)
                            .map((person) => person.name)
                            .join(", ") || "Not assigned yet"}{" "}
                          · {TASK_STATE_LABEL[task.state] ?? task.state}
                        </span>
                      </span>
                      {overdue ? (
                        <Badge tone="danger">
                          <AlertTriangle className="mr-1 inline h-3 w-3" />
                          overdue
                        </Badge>
                      ) : task.dueAt ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(task.dueAt)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}

/**
 * A section's heading, with its count and a way to the whole list.
 *
 * Asked for from use: "In review page for all different sections i need something
 * like Read All that redirect me that page with applied filters." Each card here is
 * a short summary of a question the full table answers properly — sorted, paged and
 * exportable — and this is the step between the two. The link names a view rather
 * than carrying the filters, so the list page and this one cannot disagree about
 * what "waiting to be scored" means; see lib/list-views.
 */
function SectionHeading({
  icon: Icon,
  title,
  count,
  tone = "brand",
  readAll,
}: {
  icon: LucideIcon;
  title: string;
  count: number | undefined;
  tone?: "brand" | "warning";
  readAll:
    | { to: "/journal"; search: { view: JournalView } }
    | { to: "/tasks"; search: { view: TaskView } };
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4" />
        {title}
        {count ? <Badge tone={tone}>{count}</Badge> : null}
      </h2>
      <Link
        to={readAll.to}
        search={readAll.search}
        className="shrink-0 text-xs font-medium text-primary hover:underline"
      >
        Read all
      </Link>
    </div>
  );
}
