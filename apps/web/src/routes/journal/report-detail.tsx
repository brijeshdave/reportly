// Author: Brijesh Dave <https://github.com/brijeshdave>
// A report in full, with the scoring grid. Points work in two tiers: the author's
// own split among everyone who worked it, and a single management review. A worker
// sees only the self split — the review and the official figure it sets are shown
// to the reporting manager and above, never to the person being scored.
//
// You score a report from here too, in real points (0.5 steps). Which column you
// may fill follows from who you are, decided by the server (myScoreTier). The first
// score locks the report's content; re-opening it clears every score.
import { MAX_ENTRY_POINTS, PERMISSIONS, formatDate, formatDateTime } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Ban, Lock, Wrench } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { HistoryTab } from "@/components/history-tab.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import { PointsHistoryTab } from "@/routes/journal/points-history-tab.js";
import { sessionQuery } from "@/lib/queries.js";
import { Field, Input, Spinner, Textarea } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import {
  deleteReport,
  fetchReport,
  rejectReport,
  reopenReport,
  addWorkLog,
  fetchWorkLogs,
  removeWorkLog,
  setScores,
  unrejectReport,
  updateWorkLog,
} from "@/services/journal.js";
import type { JournalEntryDetail } from "@/services/journal.js";
import type { CreateWorkLog, WorkLog } from "@reportly/shared";
import { CommentsPanel } from "@/components/comments-panel.js";
import { StatusBadge } from "@/components/report-badges.js";
import { TagList } from "@/components/tag-chip.js";
import { AssignmentPanel } from "@/routes/journal/assignment-panel.js";
import { StatusControl } from "@/routes/journal/status-control.js";
import { DowntimePanel } from "@/routes/journal/downtime-panel.js";
import { RecurrencePanel } from "@/routes/journal/recurrence-panel.js";
import { TimelinePanel } from "@/routes/journal/timeline-panel.js";
import { AttachmentsPanel } from "@/components/attachments-panel.js";

/** Points read as whole numbers or halves — "3", "3.5" — never "3.0". */
const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function JournalEntryDetailPage({ reportId, tab }: { reportId: string; tab?: string }) {
  const { data: session } = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // A search reducer has to know which route it is editing — TanStack cannot type
  // one across the whole route union, so tab changes navigate `from` this route
  // while the plain `navigate` above still handles going elsewhere.
  const navigateTab = useNavigate({ from: "/journal/$reportId" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Downtime is deliberately not frozen by the report's lock: a line still down when
  // the report is scored has to be closed afterwards, or its total never lands.
  const canWriteDowntime = usePermission(PERMISSIONS.DOWNTIME_WRITE);
  const canWriteFiles = usePermission(PERMISSIONS.ATTACHMENTS_WRITE);
  // History rows carry before/after values of other people's data, which is why the
  // endpoint is gated on `audit:view` rather than on being able to read the report.
  const canSeeHistory = usePermission(PERMISSIONS.AUDIT_VIEW);

  const report = useQuery({
    queryKey: ["reports", "detail", reportId],
    queryFn: () => fetchReport(reportId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["reports"] });
  };

  const reopen = useMutation({ mutationFn: () => reopenReport(reportId), onSuccess: invalidate });
  // A head-of-department may strike a downline entry from scoring. The button shows for
  // permission holders on someone else's report; the server enforces the reporting line.
  const canReject = usePermission(PERMISSIONS.JOURNAL_REJECT);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const reject = useMutation({
    mutationFn: () => rejectReport(reportId, rejectReason.trim() || undefined),
    onSuccess: async () => {
      await invalidate();
      setRejecting(false);
      setRejectReason("");
    },
  });
  const unreject = useMutation({
    mutationFn: () => unrejectReport(reportId),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => deleteReport(reportId),
    onSuccess: async () => {
      await invalidate();
      await navigate({ to: "/journal" });
    },
  });

  if (report.isLoading) return <Spinner />;
  if (report.error) return <ErrorAlert error={report.error} />;
  if (!report.data) return null;

  const r = report.data;
  const isAuthor = session?.user.id === r.authorId;
  // Straight from the server, never inferred from ids here: the rule admits anyone
  // above the author or assignee in the reporting line, which this component cannot
  // work out on its own.
  const canDriveStatus = r.canChangeStatus;
  const locked = Boolean(r.lockedAt);
  const rejected = Boolean(r.rejectedAt);
  // Reject applies to a submitted entry by someone below you — never your own.
  const showReject = canReject && !isAuthor && !rejected && r.state === "submitted";

  // The tab set depends on what this caller may see: the points history is blind upward,
  // the change history needs audit:view. Falls back to the entry for an unknown/out-of-
  // reach tab, so a shared "?tab=…" link never opens on a blank panel.
  const tabs = [
    { id: "report", label: "Entry" },
    ...(r.canSeePointsHistory ? [{ id: "points", label: "Points" }] : []),
    ...(canSeeHistory ? [{ id: "history", label: "Change history" }] : []),
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? (tab as string) : "report";

  const rows: [string, string | null][] = [
    ["Author", r.authorName],
    // Who is waited on. People were asking each other this, which is the sign a
    // screen is withholding something it knows. "Nobody set" is shown rather than
    // left blank: it means the entry will sit unscored until somebody fixes the
    // reporting line, and a blank reads as "fine".
    ["Reviewed by", r.reviewer ? r.reviewer.name : "Nobody set"],
    ["Department", r.departmentName],
    ["Location", r.locationName],
    ["Category", r.categoryName],
    ["Severity", r.severityName],
    ["Occurred", r.occurredAt ? formatDateTime(r.occurredAt) : null],
    [
      "Work time",
      r.durationMinutes != null
        ? `${Math.floor(r.durationMinutes / 60)}h ${r.durationMinutes % 60}m`
        : null,
    ],
  ];

  return (
    <>
      <PageHeader
        title={r.title}
        // The id is here because people quote it to each other — in a message, a
        // ticket, a support mail — and could only get it out of the address bar.
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {r.kind === "issue" ? "Issue" : "Work log"} · filed {formatDate(r.reportDate)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {r.state === "draft" ? <Badge tone="warning">draft</Badge> : null}
            {locked ? (
              <Badge tone="neutral">
                <Lock className="h-3 w-3" /> locked
              </Badge>
            ) : null}
            {/* Whoever holds it, not whoever filed it: after a handover the person
                who let go can no longer edit, and the person doing the work can. The
                server decides — this only avoids showing a button that would 403. */}
            {r.canEdit && !locked ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void navigate({ to: "/journal/$reportId/edit", params: { reportId } })
                }
              >
                Edit
              </Button>
            ) : null}
            {/* The author or a manager above them can re-open a locked report — the
                manager's way to free a reviewed report (a work log has no status
                dropdown) so its points can be set again. Re-opening clears the
                scores. */}
            {r.canReopen && locked ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => reopen.mutate()}
                disabled={reopen.isPending}
              >
                Re-open
              </Button>
            ) : null}
            {rejected ? <Badge tone="danger">Rejected</Badge> : null}
            {r.pointsReviewNeeded ? <Badge tone="warning">Points re-check needed</Badge> : null}
            {showReject ? (
              <Button size="sm" variant="destructive" onClick={() => setRejecting(true)}>
                <Ban className="h-4 w-4" /> Reject
              </Button>
            ) : null}
            {rejected && canReject ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => unreject.mutate()}
                disabled={unreject.isPending}
              >
                Un-reject
              </Button>
            ) : null}
            {isAuthor ? (
              <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
          </div>
        }
      />

      {reopen.error ? <ErrorAlert className="mb-3" error={reopen.error} /> : null}
      {reject.error ? <ErrorAlert className="mb-3" error={reject.error} /> : null}
      {unreject.error ? <ErrorAlert className="mb-3" error={unreject.error} /> : null}

      {rejected ? (
        <Card className="mb-3 border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">
            Rejected{r.rejectedByName ? ` by ${r.rejectedByName}` : ""} — it earns no points.
          </p>
          {r.rejectionReason ? (
            <p className="mt-1 text-muted-foreground">“{r.rejectionReason}”</p>
          ) : null}
        </Card>
      ) : null}

      {rejecting ? (
        <Card className="mb-3 flex flex-col gap-2 p-4">
          <span className="text-sm font-medium">Reject this report</span>
          <p className="text-xs text-muted-foreground">
            Its scores and points are cleared. You can un-reject it later to score it again.
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Reason (optional)"
            className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => reject.mutate()}
              disabled={reject.isPending}
            >
              Reject report
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Tabs appear only when there is more than the entry itself to show. The points
          history is blind upward (server-gated), and the change history needs audit:view —
          each rendered only for a caller who may actually read it. */}
      {tabs.length > 1 ? (
        <PageTabs
          tabs={tabs}
          active={activeTab}
          onSelect={(id) => void navigateTab({ search: { tab: id }, replace: true })}
        />
      ) : null}

      <TabPanel id="report" active={activeTab}>
        <div className="grid gap-4 pt-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-4">
            {/* Status sits at the top of the report, not buried in the field list
              and certainly not behind the edit form: it is the thing people come
              here to change. A work log has no triage workflow — it is a record of
              work already done — so it shows a plain "Done" badge, not the issue
              ladder. Only an issue is driven through statuses. */}
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Status</span>
                {r.kind === "work" ? (
                  <StatusBadge name={r.statusName} group={r.statusGroup} />
                ) : (
                  <StatusControl report={r} canDrive={canDriveStatus} />
                )}
              </div>
              {r.tags.length > 0 ? <TagList tags={r.tags} /> : null}
            </Card>

            <Card className="p-6">
              <dl className="grid gap-4 sm:grid-cols-2">
                {rows
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="mt-1 text-sm">{value}</dd>
                    </div>
                  ))}
              </dl>

              {/* What the report is about. Absent entirely when it is about nothing —
                which is a legitimate report, not a gap to nag about. */}
              {r.targets.length > 0 ? (
                <div className="mt-4 border-t border-border pt-4">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">About</dt>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.targets.map((target) => (
                      <span
                        key={`${target.kind}:${target.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
                      >
                        <span className="text-muted-foreground">{target.kind}</span>
                        {target.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>

            {r.kind === "issue" ? (
              <Prose
                blocks={[
                  ["What happened", r.issueSummary],
                  ["Detail", r.issueDetail],
                  ["Root cause", r.rootCause],
                  ["Preventive measures", r.preventiveMeasures],
                ]}
              />
            ) : null}
            {/* Logging the work is its own act, done here rather than by reopening the
                whole entry: an issue is raised when it happens and worked afterwards,
                sometimes by somebody reading it on the next shift. */}
            <WorkTimeline report={r} />

            {/* Evidence of the work sits with the work, in the wider column: files
              want room for thumbnails and downtime is a small table. Both used to
              be on the right, which is how that column ended up carrying seven
              panels against the left's two. */}
            <AttachmentsPanel
              ownerType="report"
              ownerId={reportId}
              canWrite={canWriteFiles}
              locked={locked}
            />
            <DowntimePanel reportId={reportId} targets={r.targets} canWrite={canWriteDowntime} />

            {/* The conversation sits with the work it is about, directly above the
              record of how that work changed. It still scrolls inside its own card,
              so a busy thread does not push the change history off the page. */}
            <CommentsPanel ownerType="report" ownerId={reportId} />
          </div>

          {/* Ordered by how often somebody acts on it: the points and who holds the
            report first, then the conversation, then the things you read rather
            than do — recurrence and the status timeline — at the bottom. */}
          <div className="flex flex-col gap-4">
            {rejected ? null : <ScoringPanel report={r} isAuthor={isAuthor} />}
            <AssignmentPanel report={r} />
            {/* Renders nothing unless this report is part of a recurrence chain — a
              first occurrence is the normal case and needs no card. */}
            <RecurrencePanel reportId={reportId} />
            <TimelinePanel reportId={reportId} />
          </div>
        </div>
      </TabPanel>

      {r.canSeePointsHistory ? (
        <TabPanel id="points" active={activeTab}>
          <PointsHistoryTab reportId={reportId} />
        </TabPanel>
      ) : null}

      {canSeeHistory ? (
        <TabPanel id="history" active={activeTab}>
          <Card className="mt-4 p-6">
            {/* "Change history", not "History": the report also carries a status
                timeline, and two things with the same name send people to the
                wrong one. This is field-level edits; that one is status moves. */}
            <h2 className="mb-3 text-sm font-semibold">Change history</h2>
            <HistoryTab entityType="reports" id={reportId} />
          </Card>
        </TabPanel>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete "${r.title}"?`}
        description="This removes the report and any scores on it. This cannot be undone."
        confirmLabel="Delete report"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}

function Prose({ blocks }: { blocks: [string, string | null][] }) {
  const shown = blocks.filter(([, value]) => value);
  if (shown.length === 0) return null;
  return (
    <Card className="flex flex-col gap-4 p-6">
      {shown.map(([label, value]) => (
        <div key={label}>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground">{label}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{value}</p>
        </div>
      ))}
    </Card>
  );
}

/**
 * The scoring grid: one row per worker, points in 0.5 steps.
 *
 * `myScoreTier` (server-computed) says which column this caller may fill — the
 * author's self split, a manager's review, or nothing. The review column is only
 * present when the caller may see it; the server hides it from the worker being
 * scored, so its absence is not something the browser has to reason about.
 *
 * The draft lives in local state and is saved on the button, not per keystroke — a
 * field bound to a round trip would otherwise reset mid-number.
 */
/**
 * What was done, item by item, in the order it happened.
 *
 * This replaced a single "Log work" that appended into the entry's one work field.
 * That had nowhere to put a *when*, and a second entry was glued onto the first — so
 * a job worked over two shifts read as one run-on paragraph belonging to nobody in
 * particular. Each item now carries who did it and the hours it took.
 *
 * Anybody on "who worked on it" may add their own; only its author may change it.
 * A closed entry takes no more — the API refuses it too, so this only avoids offering
 * a form that would 409.
 */
function WorkTimeline({ report }: { report: JournalEntryDetail }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const logs = useQuery({
    queryKey: ["reports", report.id, "work"],
    queryFn: () => fetchWorkLogs(report.id),
  });

  const closed = report.statusIsTerminal || Boolean(report.lockedAt);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["reports", report.id] });
    await queryClient.invalidateQueries({ queryKey: ["reports", report.id, "work"] });
  };

  const items = logs.data ?? [];

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Work done</h2>
        </div>
        {!closed && !open && editing === null ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Log work
          </Button>
        ) : null}
      </div>

      {logs.isLoading ? <Spinner /> : null}

      {items.length === 0 && !logs.isLoading ? (
        <p className="text-sm text-muted-foreground">
          {closed
            ? "No work was logged against this entry."
            : "Nothing logged yet. Add what you did, and when — the next person reads this."}
        </p>
      ) : null}

      <ol className="flex flex-col gap-3">
        {items.map((item) =>
          editing === item.id ? (
            <li key={item.id}>
              <WorkForm
                initial={item}
                onCancel={() => setEditing(null)}
                onSaved={async () => {
                  setEditing(null);
                  await refresh();
                }}
                save={(input) => updateWorkLog(item.id, input)}
              />
            </li>
          ) : (
            <li key={item.id} className="border-l-2 border-border pl-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{item.summary}</span>
                <span className="text-xs text-muted-foreground">{workWhen(item)}</span>
              </div>
              {item.detail ? (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.detail}</p>
              ) : null}
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{item.userName}</span>
                {item.canEdit && !closed ? (
                  <>
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => setEditing(item.id)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-destructive"
                      onClick={async () => {
                        await removeWorkLog(item.id);
                        await refresh();
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ),
        )}
      </ol>

      {open ? (
        <WorkForm
          onCancel={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false);
            await refresh();
          }}
          save={(input) => addWorkLog(report.id, input)}
        />
      ) : null}

      {closed && items.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          This entry is closed. Re-open it to log any more work against it.
        </p>
      ) : null}
    </Card>
  );
}

/** "22 Aug 08:40–09:10", or the day it was written when no times were given. */
function workWhen(item: WorkLog): string {
  if (!item.startedAt) return `logged ${formatDateTime(item.createdAt)}`;
  const start = formatDateTime(item.startedAt);
  if (!item.finishedAt) return start;
  return `${start} – ${formatDateTime(item.finishedAt).split(" ").slice(-1)[0]}`;
}

/** One work item being written or corrected. Times are optional but asked for. */
function WorkForm({
  initial,
  save,
  onSaved,
  onCancel,
}: {
  initial?: WorkLog;
  save: (input: CreateWorkLog) => Promise<unknown>;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [startedAt, setStartedAt] = useState(toLocalInput(initial?.startedAt));
  const [finishedAt, setFinishedAt] = useState(toLocalInput(initial?.finishedAt));

  const mutation = useMutation({
    mutationFn: () =>
      save({
        summary: summary.trim(),
        detail: detail.trim() || undefined,
        startedAt: fromLocalInput(startedAt),
        finishedAt: fromLocalInput(finishedAt),
      }),
    onSuccess: onSaved,
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      {mutation.error ? <ErrorAlert error={mutation.error} /> : null}
      <Field label="What you did">
        {(props) => (
          <Input
            {...props}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="e.g. Fitted the replacement belt"
          />
        )}
      </Field>
      <Field label="Details">
        {(props) => (
          <Textarea
            {...props}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            rows={3}
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Started</span>
          <Input
            type="datetime-local"
            value={startedAt}
            onChange={(event) => setStartedAt(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Finished</span>
          <Input
            type="datetime-local"
            value={finishedAt}
            onChange={(event) => setFinishedAt(event.target.value)}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={mutation.isPending || summary.trim() === ""}
          onClick={() => mutation.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/** ISO → the value a `datetime-local` input wants, in the reader's own timezone. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function ScoringPanel({ report, isAuthor }: { report: JournalEntryDetail; isAuthor: boolean }) {
  const queryClient = useQueryClient();
  const { scores, myScoreTier } = report;
  // Terminal statuses (resolved/rejected) are the finished ones; only then is there
  // work to score. The group is on the report, so no extra lookup.
  const finished = report.statusGroup !== "open";
  // The review and official columns exist only for someone who may see the review;
  // the server nulls them otherwise, so their presence is the signal to show them.
  const canSeeReview = myScoreTier === "review" || scores.some((s) => s.official !== null);

  // The value the editable column starts from: the current tier's number, and for a
  // review the worker's self split, so the manager confirms or nudges rather than
  // re-enters from zero.
  const startFor = (s: JournalEntryDetail["scores"][number]): number =>
    myScoreTier === "self" ? (s.self ?? 0) : (s.review ?? s.self ?? 0);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const valueOf = (s: JournalEntryDetail["scores"][number]): number => {
    const n = Number(draft[s.userId] ?? startFor(s));
    return Number.isFinite(n) ? n : 0;
  };
  // The whole tier shares one pot: the column may total at most MAX_ENTRY_POINTS.
  const columnTotal = myScoreTier ? scores.reduce((sum, s) => sum + valueOf(s), 0) : 0;
  const overBudget = columnTotal > MAX_ENTRY_POINTS;
  const save = useMutation({
    mutationFn: () =>
      setScores(report.id, {
        scores: scores.map((s) => ({
          userId: s.userId,
          points: Number(draft[s.userId] ?? startFor(s)),
        })),
      }),
    onSuccess: async () => {
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  if (report.state !== "submitted") {
    return (
      <Card className="p-6">
        <h2 className="text-sm font-semibold">Points</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A draft is not scored. Submit it first.
        </p>
      </Card>
    );
  }

  if (!finished) {
    return (
      <Card className="p-6">
        <h2 className="text-sm font-semibold">Points</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Points are set once the report is resolved.
        </p>
      </Card>
    );
  }

  const editableCell = (s: JournalEntryDetail["scores"][number]) => (
    <input
      type="number"
      min={0}
      step={0.5}
      value={draft[s.userId] ?? String(startFor(s))}
      aria-label={`Points for ${s.userName}`}
      disabled={save.isPending}
      onChange={(e) => setDraft((d) => ({ ...d, [s.userId]: e.target.value }))}
      className="h-8 w-16 rounded-lg border border-border bg-card px-2 text-right text-sm"
    />
  );

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-sm font-semibold">Points</h2>
      {save.error ? <ErrorAlert error={save.error} /> : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 text-left font-medium">Worked on it</th>
              <th className="py-1 text-right font-medium">Self</th>
              {canSeeReview ? <th className="py-1 text-right font-medium">Review</th> : null}
              {canSeeReview ? <th className="py-1 text-right font-medium">Official</th> : null}
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.userId} className="border-t border-border">
                <td className="py-1.5">{s.userName}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {myScoreTier === "self"
                    ? editableCell(s)
                    : s.self != null
                      ? fmtPoints(s.self)
                      : "—"}
                </td>
                {canSeeReview ? (
                  <td className="py-1.5 text-right tabular-nums">
                    {myScoreTier === "review"
                      ? editableCell(s)
                      : s.review != null
                        ? fmtPoints(s.review)
                        : "—"}
                  </td>
                ) : null}
                {canSeeReview ? (
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {s.official != null ? fmtPoints(s.official) : "—"}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {myScoreTier ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {myScoreTier === "self"
                ? "Divide the points among everyone who worked it."
                : "Your review sets the official points — only you and those above see it."}
            </p>
            <span
              className={`shrink-0 text-xs tabular-nums ${overBudget ? "font-medium text-destructive" : "text-muted-foreground"}`}
            >
              {fmtPoints(columnTotal)} / {MAX_ENTRY_POINTS}
            </span>
          </div>
          {overBudget ? (
            <p className="text-xs text-destructive">
              One report is worth at most {MAX_ENTRY_POINTS} points across everyone. Bring the total
              down to save.
            </p>
          ) : null}
          {/* "Save points", not "Save". The status control on the same page has its
              own Save, and two buttons with one name is a page where a screen
              reader announces the same word for two different acts — and where
              anything addressing them by role has to guess. */}
          <Button
            size="sm"
            className="self-end"
            onClick={() => save.mutate()}
            disabled={save.isPending || overBudget}
          >
            {save.isPending ? <Spinner /> : null}
            Save points
          </Button>
        </div>
      ) : isAuthor ? (
        <p className="text-xs text-muted-foreground">
          Your manager has reviewed this, so the split is locked. They can re-open the report to let
          you change the points.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          You can see the self split; the review is the reporting manager&rsquo;s to give.
        </p>
      )}
    </Card>
  );
}
