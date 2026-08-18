// Author: Brijesh Dave <https://github.com/brijeshdave>
// Filing a report, and editing one before it is appraised. A full page — a report
// carries a lot: kind, category, severity, the work done, and the times.
//
// Two kinds share one form. An **issue** asks for severity, root cause, preventive
// measures and a status; a **work** log asks only what was done. You can **save a
// draft** (private) or **submit** it (into the appraisal loop).
import {
  type CreateJournalEntry,
  type ReportKind,
  type Severity,
  type JournalStatus,
  type CategoryRow,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { SearchableSelect } from "@/components/searchable-select.js";
import { Field, Input, Spinner, Textarea } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchUserDepartments } from "@/services/departments.js";
import { fetchLocations } from "@/services/locations.js";
import { fetchCategories, fetchSeverities, fetchStatuses } from "@/services/journal-config.js";
import { createReport, fetchReport, updateReport } from "@/services/journal.js";
import { fetchTaskPrefill } from "@/services/tasks.js";
import { TagPicker } from "@/components/tag-picker.js";
import { ScopePicker, type ScopeTarget } from "@/routes/journal/scope-picker.js";

export type ReportEditorMode = "create" | "edit";

/** datetime-local value ("YYYY-MM-DDTHH:mm") → ISO, or undefined when blank. */
const toIso = (local: string): string | undefined =>
  local ? new Date(local).toISOString() : undefined;
/** ISO → the value a datetime-local input wants, in the viewer's local time. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface FormState {
  kind: ReportKind;
  title: string;
  departmentId: string;
  locationId: string;
  categoryId: string;
  severityId: string;
  statusId: string;
  occurredAt: string;
  startedAt: string;
  endedAt: string;
  issueSummary: string;
  issueDetail: string;
  rootCause: string;
  preventiveMeasures: string;
  workSummary: string;
  workDetail: string;
  /** What the report is about. Empty is a valid answer. */
  targets: ScopeTarget[];
}

const EMPTY: FormState = {
  kind: "issue",
  title: "",
  departmentId: "",
  locationId: "",
  categoryId: "",
  severityId: "",
  statusId: "",
  occurredAt: "",
  startedAt: "",
  endedAt: "",
  issueSummary: "",
  issueDetail: "",
  rootCause: "",
  preventiveMeasures: "",
  workSummary: "",
  workDetail: "",
  targets: [],
};

export function JournalEntryEditorPage({
  mode,
  reportId,
  taskId,
}: {
  mode: ReportEditorMode;
  reportId?: string;
  /** Set when this report is being filed to complete a task. */
  taskId?: string;
}) {
  const existing = useQuery({
    queryKey: ["reports", "detail", reportId],
    queryFn: () => fetchReport(reportId as string),
    enabled: mode === "edit" && Boolean(reportId),
  });

  // Opened from a task: the server builds the prefill from the task itself, so the
  // copied text and the link cannot be pointed at somebody else's work.
  const prefill = useQuery({
    queryKey: ["tasks", "prefill", taskId],
    queryFn: () => fetchTaskPrefill(taskId as string),
    enabled: mode === "create" && Boolean(taskId),
  });

  if (mode === "edit" && existing.isLoading) return <Spinner />;
  if (mode === "edit" && existing.error) return <ErrorAlert error={existing.error} />;
  if (mode === "create" && taskId && prefill.isLoading) return <Spinner />;
  if (mode === "create" && taskId && prefill.error) return <ErrorAlert error={prefill.error} />;

  const seed: FormState = existing.data
    ? {
        kind: existing.data.kind,
        title: existing.data.title,
        departmentId: existing.data.departmentId ?? "",
        locationId: existing.data.locationId ?? "",
        categoryId: existing.data.categoryId ?? "",
        severityId: existing.data.severityId ?? "",
        statusId: existing.data.statusId ?? "",
        occurredAt: toLocalInput(existing.data.occurredAt),
        startedAt: toLocalInput(existing.data.startedAt),
        endedAt: toLocalInput(existing.data.endedAt),
        issueSummary: existing.data.issueSummary ?? "",
        issueDetail: existing.data.issueDetail ?? "",
        rootCause: existing.data.rootCause ?? "",
        preventiveMeasures: existing.data.preventiveMeasures ?? "",
        workSummary: existing.data.workSummary ?? "",
        workDetail: existing.data.workDetail ?? "",
        // The detail read resolves each link's label, so the chips draw straight away.
        targets: existing.data.targets,
      }
    : prefill.data
      ? {
          ...EMPTY,
          kind: prefill.data.kind,
          title: prefill.data.title,
          departmentId: prefill.data.departmentId ?? "",
          // The brief becomes the starting point of the work log — the person edits
          // it into what they actually did rather than retyping the job from memory.
          workSummary: prefill.data.workSummary ?? "",
        }
      : EMPTY;

  return (
    <Editor
      mode={mode}
      reportId={reportId}
      seed={seed}
      seedTagIds={existing.data?.tags.map((t) => t.id) ?? []}
      taskId={taskId}
    />
  );
}

function Editor({
  mode,
  reportId,
  seed,
  seedTagIds,
  taskId,
}: {
  mode: ReportEditorMode;
  reportId?: string;
  seed: FormState;
  seedTagIds: string[];
  taskId?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(seed);
  // Kept beside the form rather than inside it: tags are a list of ids, not a text
  // field, and the form's generic `set(key, value)` is typed for strings.
  const [tagIds, setTagIds] = useState<string[]>(seedTagIds);

  const { data: session } = useQuery(sessionQuery);
  const me = session?.user;

  // The reporter's own departments — you cannot file for one you are not in.
  const myDepartmentsQuery = useQuery({
    queryKey: ["users", me?.id, "departments"],
    queryFn: () => fetchUserDepartments(me!.id),
    enabled: Boolean(me?.id),
  });
  // This company's only: an entry is filed against the active company, so a
  // membership at another one is not a candidate — it would be rejected on save.
  const myDepartments = (myDepartmentsQuery.data ?? []).filter(
    (d) => d.companyId === session?.companyId,
  );
  const departmentChoices = departmentOptions(
    myDepartments.map((d) => ({ value: d.departmentId, name: d.name, path: d.path })),
  );

  // Scoped by the API to the sites this person's groups reach.
  const locations = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  // With exactly one department there is nothing to choose, so it is filled in
  // rather than left blank for somebody to wonder about. With several, they pick.
  useEffect(() => {
    if (!form.departmentId && myDepartments.length > 0) {
      set("departmentId", myDepartments[0]!.departmentId);
    }
  }, [myDepartments, form.departmentId]);

  const severities = useQuery({
    queryKey: ["report-config", "severities"],
    queryFn: fetchSeverities,
  });
  const statuses = useQuery({ queryKey: ["report-config", "statuses"], queryFn: fetchStatuses });
  const categories = useQuery({
    queryKey: ["report-config", "categories", form.departmentId],
    queryFn: () => fetchCategories(form.departmentId),
    enabled: Boolean(form.departmentId),
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const build = (state: "draft" | "submitted"): CreateJournalEntry => ({
    kind: form.kind,
    title: form.title.trim(),
    state,
    departmentId: form.departmentId || undefined,
    locationId: form.locationId || undefined,
    categoryId: form.categoryId || undefined,
    // Always sent, so clearing every tag actually clears them. The API leaves tags
    // alone only when the key is absent, which is a state this form never wants.
    tagIds,
    severityId: form.kind === "issue" && form.severityId ? form.severityId : undefined,
    statusId: form.kind === "issue" && form.statusId ? form.statusId : undefined,
    occurredAt: form.kind === "issue" ? toIso(form.occurredAt) : undefined,
    startedAt: toIso(form.startedAt),
    endedAt: toIso(form.endedAt),
    issueSummary: form.kind === "issue" ? form.issueSummary.trim() || undefined : undefined,
    issueDetail: form.kind === "issue" ? form.issueDetail.trim() || undefined : undefined,
    rootCause: form.kind === "issue" ? form.rootCause.trim() || undefined : undefined,
    preventiveMeasures:
      form.kind === "issue" ? form.preventiveMeasures.trim() || undefined : undefined,
    workSummary: form.workSummary.trim() || undefined,
    workDetail: form.workDetail.trim() || undefined,
    // Always sent, including when empty: on an edit that is how scope is cleared.
    targets: form.targets.map(({ kind, id }) => ({ kind, id })),
  });

  const save = useMutation({
    mutationFn: (state: "draft" | "submitted") =>
      mode === "edit"
        ? updateReport(reportId!, build(state))
        : createReport({ ...build(state), ...(taskId ? { taskId } : {}) }),
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      await navigate({ to: "/journal/$reportId", params: { reportId: report.id } });
    },
  });

  const submit = (event: FormEvent) => event.preventDefault();
  const isIssue = form.kind === "issue";
  const activeSeverities = (severities.data ?? []).filter((s: Severity) => s.status === "active");
  const activeStatuses = (statuses.data ?? []).filter((s: JournalStatus) => s.status === "active");
  const activeCategories = (categories.data ?? []).filter(
    (c: CategoryRow) => c.status === "active",
  );

  return (
    <>
      <PageHeader
        title={mode === "edit" ? "Edit entry" : "New entry"}
        description="Everyone files reports of their work. Save a draft to finish later, or submit it for your managers to see and score."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void navigate({ to: "/journal" })}>
            Back to reports
          </Button>
        }
      />

      {/* Wider than the old max-w-2xl: the scope picker walks down the asset tree
          with a dropdown per level, and a deep path needs room to read rather than
          being cut off. Still capped, so lines of prose do not run the full width
          of a large monitor. */}
      <form onSubmit={submit} className="mt-2 flex max-w-5xl flex-col gap-4">
        {save.error ? <ErrorAlert error={save.error} /> : null}

        <Card className="flex flex-col gap-4 p-6">
          <div className="flex gap-2">
            {(["issue", "work"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => set("kind", kind)}
                className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                  form.kind === kind
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {kind === "issue" ? "Issue / breakdown" : "Work log"}
              </button>
            ))}
          </div>

          <Field label="Title">
            {(props) => (
              <Input
                {...props}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                required
                autoFocus
                placeholder={isIssue ? "e.g. Conveyor jam on line 3" : "e.g. Daily QC round"}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Department is the reporter's own, not a free choice: you cannot
                file on behalf of a department you are not in. Somebody in one
                department sees it stated; somebody in several picks among their
                own — and in both cases the list is theirs, not the company's. */}
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Department</span>
              {myDepartments.length > 1 ? (
                <SearchableSelect
                  ariaLabel="Department"
                  value={form.departmentId}
                  onChange={(value) => {
                    set("departmentId", value);
                    // Categories and tags belong to a department, so changing it
                    // invalidates both — clearing beats silently keeping a label
                    // the new department does not have.
                    set("categoryId", "");
                    setTagIds([]);
                  }}
                  options={departmentChoices}
                  placeholder="Pick a department"
                />
              ) : (
                <p className="flex h-10 items-center rounded-xl border border-border bg-muted px-3 text-sm text-muted-foreground">
                  {myDepartments[0]?.name ?? "You are not in a department yet"}
                </p>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Site</span>
              <select
                value={form.locationId}
                onChange={(e) => set("locationId", e.target.value)}
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
              >
                {/* Only the sites this person's groups reach, so the picker cannot
                    offer one the API would refuse. */}
                <option value="">Not set</option>
                {(locations.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Category</span>
              <select
                value={form.categoryId}
                onChange={(e) => set("categoryId", e.target.value)}
                disabled={!form.departmentId}
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm disabled:opacity-50"
              >
                <option value="">None</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Tags</span>
            <p className="text-xs text-muted-foreground">
              As many as apply — the category is the one kind of problem this is, tags are anything
              else you might search by later.
            </p>
            <TagPicker
              departmentId={form.departmentId || null}
              value={tagIds}
              onChange={setTagIds}
            />
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-sm font-semibold">What is it about?</h2>
            <p className="text-xs text-muted-foreground">
              Pick anything this concerns — a line, the machines on it, a department, a person.
              Issues on a device roll up to the asset it stands at. All optional.
            </p>
          </div>
          <ScopePicker
            value={form.targets}
            onChange={(next) => set("targets", next)}
            locationId={form.locationId || null}
          />
        </Card>

        {isIssue ? (
          <Card className="flex flex-col gap-4 p-6">
            <h2 className="text-sm font-semibold">The issue</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Severity</span>
                <select
                  value={form.severityId}
                  onChange={(e) => set("severityId", e.target.value)}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                >
                  <option value="">None</option>
                  {activeSeverities.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Status</span>
                <select
                  value={form.statusId}
                  onChange={(e) => set("statusId", e.target.value)}
                  className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                >
                  {activeStatuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <Field label="What happened (short)">
              {(props) => (
                <Input
                  {...props}
                  value={form.issueSummary}
                  onChange={(e) => set("issueSummary", e.target.value)}
                />
              )}
            </Field>
            <Field label="Detailed description">
              {(props) => (
                <Textarea
                  {...props}
                  value={form.issueDetail}
                  onChange={(e) => set("issueDetail", e.target.value)}
                  rows={3}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Occurred at</span>
                <Input
                  type="datetime-local"
                  value={form.occurredAt}
                  onChange={(e) => set("occurredAt", e.target.value)}
                />
              </label>
            </div>
            <Field label="Root cause">
              {(props) => (
                <Textarea
                  {...props}
                  value={form.rootCause}
                  onChange={(e) => set("rootCause", e.target.value)}
                  rows={2}
                />
              )}
            </Field>
            <Field label="Preventive measures">
              {(props) => (
                <Textarea
                  {...props}
                  value={form.preventiveMeasures}
                  onChange={(e) => set("preventiveMeasures", e.target.value)}
                  rows={2}
                />
              )}
            </Field>
          </Card>
        ) : null}

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-sm font-semibold">Work done</h2>
          <Field label="Summary">
            {(props) => (
              <Input
                {...props}
                value={form.workSummary}
                onChange={(e) => set("workSummary", e.target.value)}
              />
            )}
          </Field>
          <Field label="Details">
            {(props) => (
              <Textarea
                {...props}
                value={form.workDetail}
                onChange={(e) => set("workDetail", e.target.value)}
                rows={3}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <label
              className="flex flex-col gap-1 text-sm"
              title="When YOU picked the job up — not when the machine stopped. If you were called at 2am but only started at 6am, put 6am."
            >
              <span className="font-medium">Started work</span>
              <Input
                type="datetime-local"
                value={form.startedAt}
                onChange={(e) => set("startedAt", e.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-1 text-sm"
              title="When you were done with it — including any watching or checking afterwards. Not when the machine came back."
            >
              <span className="font-medium">Finished work</span>
              <Input
                type="datetime-local"
                value={form.endedAt}
                onChange={(e) => set("endedAt", e.target.value)}
              />
            </label>
          </div>
          {/* This said "coming soon" of downtime long after downtime shipped —
              so the screen was telling people the very separation it was making
              did not exist yet, and the two got confused anyway. */}
          <div className="-mt-1 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Which time goes where</p>
            <ul className="mt-1 space-y-1">
              <li>
                <strong>Here</strong> — your own hours on the job, start to finish, including
                watching it afterwards. Leave both empty if you would rather not say.
              </li>
              <li>
                <strong>Downtime</strong> — how long production actually stopped. Recorded on this
                entry once you save it, per machine.
              </li>
            </ul>
            <p className="mt-1.5">
              They are unrelated on purpose, and often differ. A machine back in five minutes that
              you then watched for two hours is five minutes of downtime and two hours of your time.
              An issue that never stopped production is all work time and no downtime at all.
            </p>
          </div>
        </Card>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background py-3">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={save.isPending || form.title.trim() === ""}
            onClick={() => save.mutate("draft")}
          >
            Save draft
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={save.isPending || form.title.trim() === ""}
            onClick={() => save.mutate("submitted")}
          >
            {save.isPending ? <Spinner /> : null}
            Submit
          </Button>
        </div>
      </form>
    </>
  );
}
