// Author: Brijesh Dave <https://github.com/brijeshdave>
// Filing a report, and editing one before it is appraised. A full page — a report
// carries a lot: kind, category, severity, the work done, and the times.
//
// Two kinds share one form. An **issue** asks for severity, root cause, preventive
// measures and a status; a **work** log asks only what was done. You can **save a
// draft** (private) or **submit** it (into the appraisal loop).
import {
  createJournalEntrySchema,
  type CreateJournalEntry,
  type ReportKind,
  type Severity,
  type JournalStatus,
  type CategoryRow,
} from "@reportly/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SearchableSelect } from "@/components/searchable-select.js";
import { Field, Input, Select, Spinner, Textarea } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { useForm } from "@/hooks/use-form.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchMyDepartments } from "@/services/departments.js";
import { fetchMyLocations } from "@/services/locations.js";
import { fetchCategories, fetchSeverities, fetchStatuses } from "@/services/journal-config.js";
import { createReport, fetchEntryRules, fetchReport, updateReport } from "@/services/journal.js";
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
        // Left empty rather than seeded from the entry: the edit form does not draw
        // the work fields at all, because what was done lives on the work timeline
        // and the entry's copy of it is a roll-up nothing should type into.
        workSummary: "",
        workDetail: "",
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
  // Which button was pressed. A ref, not state: the click has to be readable by the
  // submit that follows it in the same tick, and a `useState` set here would still be
  // the previous value when the payload is built.
  const intent = useRef<"draft" | "submitted">("submitted");
  // Kept beside the form rather than inside it: tags are a list of ids, not a text
  // field, and the form's generic `set(key, value)` is typed for strings.
  const [tagIds, setTagIds] = useState<string[]>(seedTagIds);

  const { data: session } = useQuery(sessionQuery);
  // Whether this company still files a second kind of entry. Off, and everything
  // filed is a breakdown — which is what the form then submits, without asking.
  const plannedWork = session?.plannedWork ?? false;
  const me = session?.user;

  // The reporter's own departments — you cannot file for one you are not in.
  const myDepartmentsQuery = useQuery({
    queryKey: ["users", me?.id, "departments"],
    queryFn: () => fetchMyDepartments(),
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
  const locations = useQuery({ queryKey: ["locations"], queryFn: fetchMyLocations });

  const build = (values: FormState, state: "draft" | "submitted") => ({
    kind: values.kind,
    title: values.title.trim(),
    state,
    departmentId: values.departmentId || undefined,
    locationId: values.locationId || undefined,
    categoryId: values.categoryId || undefined,
    // Always sent, so clearing every tag actually clears them. The API leaves tags
    // alone only when the key is absent, which is a state this form never wants.
    tagIds,
    severityId: values.kind === "issue" && values.severityId ? values.severityId : undefined,
    statusId: values.kind === "issue" && values.statusId ? values.statusId : undefined,
    occurredAt: values.kind === "issue" ? toIso(values.occurredAt) : undefined,
    startedAt: toIso(values.startedAt),
    endedAt: toIso(values.endedAt),
    issueSummary: values.kind === "issue" ? values.issueSummary.trim() || undefined : undefined,
    issueDetail: values.kind === "issue" ? values.issueDetail.trim() || undefined : undefined,
    rootCause: values.kind === "issue" ? values.rootCause.trim() || undefined : undefined,
    preventiveMeasures:
      values.kind === "issue" ? values.preventiveMeasures.trim() || undefined : undefined,
    // Only when filing. On an edit these are not accepted: they are a roll-up of the
    // work timeline, and the entry's own Log work is where a correction belongs.
    ...(mode === "create"
      ? {
          workSummary: values.workSummary.trim() || undefined,
          workDetail: values.workDetail.trim() || undefined,
        }
      : {}),
    // Always sent, including when empty: on an edit that is how scope is cleared.
    targets: values.targets.map(({ kind, id }) => ({ kind, id })),
  });

  const editor = useForm<FormState, unknown>({
    // The route's own schema, not a copy of it: a rule can only be enforced in two
    // places if it is written in one. A **draft** is checked for shape alone, which
    // is what the schema itself says — the required fields are conditioned on being
    // submitted.
    schema: createJournalEntrySchema,
    initial: seed,
    toPayload: (values) => build(values, intent.current),
    // The parsed payload is deliberately not what gets sent. `createJournalEntrySchema`
    // no longer carries root cause or preventive measures — they belong to closing an
    // issue — so parsing would strip them out of an edit that is correcting them. The
    // schema decides whether this is allowed; the builder decides what goes.
    submit: async () => {
      const payload = build(editorValues.current, intent.current);
      return mode === "edit"
        ? updateReport(reportId!, payload)
        : createReport({ ...payload, ...(taskId ? { taskId } : {}) } as CreateJournalEntry);
    },
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: ["reports"] });
      await navigate({
        to: "/journal/$reportId",
        params: { reportId: (report as { id: string }).id },
      });
    },
  });

  // `submit` closes over the values as they were when it was built; this is the pair
  // of eyes on the current ones.
  const editorValues = useRef(editor.values);
  editorValues.current = editor.values;

  const form = editor.values;
  const set = editor.set;
  const saving = editor.submitting;
  const save = (state: "draft" | "submitted") => {
    intent.current = state;
    void editor.handleSubmit();
  };

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

  const isIssue = form.kind === "issue";
  // Only when *filing* an issue. Editing one keeps the fields open — correcting a
  // typo in what you already wrote should not need a different screen — and a work
  // log is nothing but work.
  // The work fields belong to the timeline on the entry now, not to this form — one
  // job worked over two shifts is several items, and a form cannot hold that. They
  // stay here only for a **work log**, whose whole content is what was done, and for
  // an issue being filed by somebody who has already finished the job.
  // The shortcut — "I already did the work" — exists so a breakdown can be raised at
  // the machine and written up later. Where the installation has made work
  // mandatory, it is not offered: reported from use as the way people were skipping
  // the record entirely. The server refuses such a submit either way; this is what
  // stops somebody being refused by a form that offered them the choice.
  const rules = useQuery({ queryKey: ["journal", "entry-rules"], queryFn: fetchEntryRules });
  const workRequired = rules.data?.requireWorkOnIssue ?? false;
  const collapsible = isIssue && mode === "create" && !workRequired;
  const [workOpen, setWorkOpen] = useState(false);
  const activeSeverities = (severities.data ?? []).filter((s: Severity) => s.status === "active");
  const activeStatuses = (statuses.data ?? []).filter((s: JournalStatus) => s.status === "active");
  // Only the statuses an entry may be *filed* at. An issue enters the workflow at the
  // start of it — filing straight into Resolved skips triage entirely and leaves a
  // status timeline that began where it should stop. The server refuses it either
  // way; this is what stops the form offering a choice the save will not take.
  const openStatuses = activeStatuses.filter(
    (s: JournalStatus) => s.group === "open" && !s.isTerminal,
  );
  const activeCategories = (categories.data ?? []).filter(
    (c: CategoryRow) => c.status === "active",
  );

  return (
    <>
      <PageHeader
        title={mode === "edit" ? "Edit entry" : "New entry"}
        description="Everyone files what they did here. Save a draft to finish later, or submit it for your managers to see and score."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void navigate({ to: "/journal" })}>
            Back to the journal
          </Button>
        }
      />

      {/* Wider than the old max-w-2xl: the scope picker walks down the asset tree
          with a dropdown per level, and a deep path needs room to read rather than
          being cut off. Still capped, so lines of prose do not run the full width
          of a large monitor. */}
      <form
        ref={editor.formRef}
        onSubmit={editor.handleSubmit}
        className="mt-2 flex max-w-5xl flex-col gap-4"
      >
        {/* What could not be blamed on a field — a permission, a conflict, a network
            failure. Everything the server could attribute is under its own input. */}
        {editor.formError ? <ErrorAlert error={editor.formError} /> : null}

        <Card className="flex flex-col gap-4 p-6">
          {/* Only when this company still files both. An entry carries its own
              work-log timeline, so the second kind means no more than "nothing
              broke here" — and the two sharing the words "work log" is what had
              people filing ordinary work as Kind: WorkLog by accident. */}
          <div className={plannedWork ? "flex gap-2" : "hidden"}>
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
                {kind === "issue" ? "Issue / breakdown" : "Planned work"}
              </button>
            ))}
          </div>

          <Field label="Title" required error={editor.errorFor("title")}>
            {(props) => (
              <Input
                {...props}
                {...editor.register("title")}
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
              <Field label="Severity" required error={editor.errorFor("severityId")}>
                {(props) => (
                  <Select {...props} {...editor.register("severityId")}>
                    <option value="">Choose one</option>
                    {activeSeverities.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Status" required error={editor.errorFor("statusId")}>
                {(props) => (
                  <Select {...props} {...editor.register("statusId")}>
                    {openStatuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Field label="What happened (short)" required error={editor.errorFor("issueSummary")}>
              {(props) => <Input {...props} {...editor.register("issueSummary")} />}
            </Field>
            <Field label="Detailed description" required error={editor.errorFor("issueDetail")}>
              {(props) => <Textarea {...props} {...editor.register("issueDetail")} rows={3} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Occurred at" required error={editor.errorFor("occurredAt")}>
                {(props) => (
                  <Input
                    {...props}
                    type="datetime-local"
                    {...editor.register("occurredAt")}
                    max={nowForInput()}
                  />
                )}
              </Field>
            </div>
            {/* Root cause and preventive measures belong to *closing* the issue, not to
                raising it: filled in before anybody has looked at the machine they are a
                guess, and a guess written into the record reads later as a finding. On a
                new entry they are not offered at all; the Resolve step asks for them and
                will not finish without them. They stay here on an edit so a wording can
                be corrected without re-opening anything. */}
            {mode === "edit" ? (
              <>
                <Field label="Root cause" error={editor.errorFor("rootCause")}>
                  {(props) => <Textarea {...props} {...editor.register("rootCause")} rows={2} />}
                </Field>
                <Field label="Preventive measures" error={editor.errorFor("preventiveMeasures")}>
                  {(props) => (
                    <Textarea {...props} {...editor.register("preventiveMeasures")} rows={2} />
                  )}
                </Field>
              </>
            ) : null}
          </Card>
        ) : null}

        {/* Raising a breakdown and recording the fix are two moments, and asking for
            both at once asks somebody sounding an alarm to describe work that has not
            happened yet. So on a new issue the work fields start closed — and stay
            available, because sometimes the honest entry really is "belt snapped, I
            replaced it" and two screens for that would be worse. A work log is
            nothing but work done, so it is never collapsed. */}
        {mode === "edit" ? (
          <Card className="flex flex-col gap-2 p-6">
            <h2 className="text-sm font-semibold">Work done</h2>
            <p className="text-sm text-muted-foreground">
              Work is logged on the entry itself, item by item — go back to it and use{" "}
              <strong className="font-medium text-foreground">Log work</strong>. Editing it here
              would overwrite a timeline several people may have written.
            </p>
          </Card>
        ) : (
          <Card className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">
                Work done
                {workRequired && isIssue ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    required on this installation
                  </span>
                ) : null}
              </h2>
              {collapsible ? (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={workOpen}
                    onChange={(event) => setWorkOpen(event.target.checked)}
                  />
                  I already did the work
                </label>
              ) : null}
            </div>
            {collapsible && !workOpen ? (
              <p className="text-sm text-muted-foreground">
                Raise it now and log the work later, from the entry itself — or tick the box if it
                is already done.
              </p>
            ) : (
              <>
                {/* Work claimed here becomes the entry's first work log item, so it is
                    held to a work log's rules — and every one of these has to be able to
                    show its own message. They were left unwired when the issue fields
                    were converted, which made a form that refused to submit and said
                    nothing: the messages were set on fields that drew none, and there
                    was no input for the focus to move to. */}
                <Field label="Summary" required error={editor.errorFor("workSummary")}>
                  {(props) => <Input {...props} {...editor.register("workSummary")} />}
                </Field>
                <Field label="Details" required error={editor.errorFor("workDetail")}>
                  {(props) => <Textarea {...props} {...editor.register("workDetail")} rows={3} />}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Started work"
                    required
                    error={editor.errorFor("startedAt")}
                    hint="When YOU picked the job up — not when the machine stopped. If you were called at 2am but only started at 6am, put 6am."
                  >
                    {(props) => (
                      <Input {...props} type="datetime-local" {...editor.register("startedAt")} />
                    )}
                  </Field>
                  <Field
                    label="Finished work"
                    required
                    error={editor.errorFor("endedAt")}
                    hint="When you were done with it — including any watching or checking afterwards. Not when the machine came back."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="datetime-local"
                        {...editor.register("endedAt")}
                        max={nowForInput()}
                      />
                    )}
                  </Field>
                </div>
                {/* This said "coming soon" of downtime long after downtime shipped —
              so the screen was telling people the very separation it was making
              did not exist yet, and the two got confused anyway. */}
                <div className="-mt-1 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Which time goes where</p>
                  <ul className="mt-1 space-y-1">
                    <li>
                      <strong>Here</strong> — your own hours on the job, start to finish, including
                      watching it afterwards. Both are needed: an item with no hours cannot be read
                      as a shift, or set beside a colleague's.
                    </li>
                    <li>
                      <strong>Downtime</strong> — how long production actually stopped. Recorded on
                      this entry once you save it, per machine.
                    </li>
                  </ul>
                  <p className="mt-1.5">
                    They are unrelated on purpose, and often differ. A machine back in five minutes
                    that you then watched for two hours is five minutes of downtime and two hours of
                    your time. An issue that never stopped production is all work time and no
                    downtime at all.
                  </p>
                </div>
              </>
            )}
          </Card>
        )}

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background py-3">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={saving || form.title.trim() === ""}
            onClick={() => save("draft")}
          >
            Save draft
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={saving || form.title.trim() === ""}
            onClick={() => save("submitted")}
          >
            {saving ? <Spinner /> : null}
            Submit
          </Button>
        </div>
      </form>
    </>
  );
}

/**
 * Now, as a `datetime-local` value — the ceiling on "Occurred at".
 *
 * A native `max` is what stops the picker offering next month at all; the schema
 * refuses a future occurrence anyway, and a control that lets somebody choose what
 * the form will then reject is a control that wasted their time.
 */
function nowForInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
