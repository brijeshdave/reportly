// Author: Brijesh Dave <https://github.com/brijeshdave>
// The report workspace — one component behind three routes: viewing a saved report,
// building a new one, and editing one. It holds a report definition (range, grouping,
// columns, filters), runs it live as the controls change, renders the result in an
// A4-print layout, and offers Print / Excel / HTML. In new/edit mode it also carries
// the view's name, description and who it is shared with, and saves.
import {
  DEFAULT_REPORT_COLUMNS,
  MAX_CUSTOM_RANGE_DAYS,
  PERMISSIONS,
  REPORT_COLUMNS,
  REPORT_COLUMN_LABELS,
  REPORT_GROUPINGS,
  REPORT_GROUPING_LABELS,
  REPORT_RANGES,
  REPORT_RANGE_LABELS,
  REPORT_SOURCES,
  isPartSource,
  sourceSupportsPerson,
  REPORT_SOURCE_LABELS,
  isShiftSource,
  REPORT_VIEW_ACCESS,
  REPORT_VIEW_ACCESS_LABELS,
  type ReportColumn,
  type ReportDefinition,
  type ReportGrouping,
  type ReportRange,
  type ReportResult,
  type ReportRow,
  type ReportSource,
  type ReportViewAccess,
  formatDate,
  formatDurationMinutes,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileSpreadsheet, FileText, Play, Printer, RotateCcw, Save } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { AssetCascadePicker } from "@/components/asset-cascade-picker.js";
import { assetOptions } from "@/lib/asset-paths.js";
import { sessionQuery } from "@/lib/queries.js";
import { usePermission } from "@/components/can.js";
import { MultiSelect } from "@/components/multi-select.js";
import { type SelectOption } from "@/components/searchable-select.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Select, Spinner, Textarea } from "@/components/ui/form.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { fetchAssets } from "@/services/assets.js";
import { fetchCategories, fetchSeverities, fetchStatuses } from "@/services/journal-config.js";
import { fetchDepartments, fetchOrgPeople } from "@/services/departments.js";
import { fetchLocations } from "@/services/locations.js";
import {
  createReportView,
  exportReportHtml,
  exportReportXlsx,
  fetchDevicesForPicker,
  fetchGroupsForPicker,
  fetchReportView,
  runReport,
  updateReportView,
} from "@/services/reports.js";
import { fetchTags } from "@/services/vocabulary.js";

export type WorkspaceMode = "view" | "new" | "edit";

/** Flatten the department tree to indented options for the shift-report picker. */
function flattenDepartments(
  nodes: { id: string; name: string; children?: unknown[] }[],
  depth = 0,
): { id: string; label: string }[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${"— ".repeat(depth)}${node.name}` },
    ...flattenDepartments(
      (node.children ?? []) as { id: string; name: string; children?: unknown[] }[],
      depth + 1,
    ),
  ]);
}

const EMPTY_DEFINITION: ReportDefinition = {
  source: "journal",
  range: "this_month",
  grouping: "none",
  columns: DEFAULT_REPORT_COLUMNS,
  filters: {},
};

export function ReportWorkspace({ mode, viewId }: { mode: WorkspaceMode; viewId?: string }) {
  const canManage = usePermission(PERMISSIONS.REPORTS_MANAGE);
  const canExport = usePermission(PERMISSIONS.REPORTS_EXPORT);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const savedView = useQuery({
    queryKey: ["report-views", viewId],
    queryFn: () => fetchReportView(viewId!),
    enabled: Boolean(viewId),
  });

  const [definition, setDefinition] = useState<ReportDefinition>(EMPTY_DEFINITION);
  const [name, setName] = useState(mode === "new" ? "New report" : "");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<ReportViewAccess>("private");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(mode === "new");

  /**
   * The definition the report on screen was actually generated from. It only moves
   * when Generate is pressed — changing a control re-shapes `definition` but leaves
   * the report standing, so a half-set-up report never fires a query. The first load
   * generates once, so opening a saved report shows it straight away.
   */
  const [applied, setApplied] = useState<ReportDefinition | null>(
    mode === "new" ? EMPTY_DEFINITION : null,
  );

  // Load the saved view into local state once, and generate it that first time.
  useEffect(() => {
    if (savedView.data && !hydrated) {
      setDefinition(savedView.data.definition);
      setApplied(savedView.data.definition);
      setName(savedView.data.name);
      setDescription(savedView.data.description ?? "");
      setAccess(savedView.data.access);
      setGroupIds(savedView.data.groupIds);
      setHydrated(true);
    }
  }, [savedView.data, hydrated]);

  const result = useQuery({
    queryKey: ["report-run", applied],
    queryFn: () => runReport({ definition: applied! }),
    enabled: applied !== null,
  });

  // Controls changed since the report was generated — the Generate button lights up.
  const dirty = applied !== null && JSON.stringify(applied) !== JSON.stringify(definition);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name, description, access, groupIds, definition };
      if (mode === "edit" && viewId) return updateReportView(viewId, payload);
      return createReportView(payload);
    },
    onSuccess: async (view) => {
      await queryClient.invalidateQueries({ queryKey: ["report-views"] });
      await navigate({ to: "/reports/$viewId", params: { viewId: view.id } });
    },
  });

  // Exports must match the report on screen, so they use what was generated.
  const runBody = { definition: applied ?? definition };
  const fileBase = (name || "report").trim();

  if (viewId && savedView.isLoading && !hydrated) return <Spinner />;
  if (savedView.error) return <ErrorAlert error={savedView.error} />;

  const editing = mode === "new" || mode === "edit";

  // The definition this report started from — the saved view's own, or a blank one
  // for a new report. "Reset" returns the controls (and the report) to it.
  const original = savedView.data?.definition ?? EMPTY_DEFINITION;
  const changed = JSON.stringify(definition) !== JSON.stringify(original);
  const resetToSaved = () => {
    setDefinition(original);
    setApplied(original);
  };

  return (
    // On large screens the workspace fills the main area and each column scrolls on
    // its own; on small screens it just stacks and the page scrolls as usual.
    <div className="flex flex-col lg:h-full">
      <PrintStyle />
      <PageHeader
        title={editing ? (mode === "new" ? "New report" : `Edit — ${name}`) : name || "Report"}
        description={
          editing
            ? "Shape the report, preview it live, and save it for later. Sharing decides who else may run it."
            : (savedView.data?.description ?? undefined)
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print / PDF
            </Button>
            {canExport ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportReportXlsx(runBody, `${fileBase}.xlsx`)}
                >
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                  Excel
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportReportHtml(runBody, `${fileBase}.html`)}
                >
                  <FileText className="mr-1.5 h-4 w-4" />
                  HTML
                </Button>
              </>
            ) : null}
            {editing && canManage ? (
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={save.isPending || !name.trim()}
              >
                <Save className="mr-1.5 h-4 w-4" />
                {mode === "edit" ? "Save changes" : "Save report"}
              </Button>
            ) : null}
          </div>
        }
      />

      {save.error ? <ErrorAlert error={save.error} /> : null}

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[320px_1fr]">
        {/* Controls — never printed. Generate stays pinned at the top so it is always
            in reach however long the options grow; only the options below scroll. */}
        <div className="no-print flex flex-col gap-3 lg:min-h-0">
          <div className="flex shrink-0 flex-col gap-2">
            <div className="flex gap-2">
              <Button
                onClick={() => setApplied(definition)}
                disabled={result.isFetching || (!dirty && applied !== null)}
                className="flex-1"
              >
                <Play className="mr-1.5 h-4 w-4" />
                {result.isFetching ? "Generating…" : dirty ? "Generate report" : "Up to date"}
              </Button>
              {changed ? (
                <Button
                  variant="secondary"
                  onClick={resetToSaved}
                  disabled={result.isFetching}
                  title="Discard your changes and go back to the saved report"
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  Reset
                </Button>
              ) : null}
            </div>
            {dirty ? (
              <p className="text-xs text-muted-foreground">
                Options changed — press Generate to run the report with them.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            {editing ? (
              <MetaPanel
                name={name}
                setName={setName}
                description={description}
                setDescription={setDescription}
                access={access}
                setAccess={setAccess}
                groupIds={groupIds}
                setGroupIds={setGroupIds}
              />
            ) : null}
            <ControlsPanel definition={definition} setDefinition={setDefinition} />
          </div>
        </div>

        {/* The printable report — its own scroll, independent of the options. */}
        <div className="report-print lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          {result.isLoading ? <Spinner /> : null}
          {result.error ? <ErrorAlert error={result.error} /> : null}
          {result.data ? <ReportView result={result.data} title={name || "Report"} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- the controls ------------------------------ */

function ControlsPanel({
  definition,
  setDefinition,
}: {
  definition: ReportDefinition;
  setDefinition: (d: ReportDefinition) => void;
}) {
  const patch = (p: Partial<ReportDefinition>) => setDefinition({ ...definition, ...p });
  // The id filters are any-of arrays; the multi-select edits them directly.
  const setFilter = (key: keyof ReportDefinition["filters"], values: string[]) =>
    patch({ filters: { ...definition.filters, [key]: values.length > 0 ? values : undefined } });
  const filterValues = (key: keyof ReportDefinition["filters"]): string[] => {
    const v = definition.filters[key];
    return Array.isArray(v) ? (v as string[]) : [];
  };
  const setFlag = (key: "recurring" | "openOnly", on: boolean) =>
    patch({ filters: { ...definition.filters, [key]: on || undefined } });

  const categories = useQuery({
    queryKey: ["report-config", "categories"],
    queryFn: () => fetchCategories(),
  });
  const severities = useQuery({
    queryKey: ["report-config", "severities"],
    queryFn: fetchSeverities,
  });
  const statuses = useQuery({ queryKey: ["report-config", "statuses"], queryFn: fetchStatuses });
  const tags = useQuery({ queryKey: ["vocabulary", "tags"], queryFn: () => fetchTags() });
  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const locations = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const people = useQuery({ queryKey: ["org", "people"], queryFn: fetchOrgPeople });
  const assets = useQuery({ queryKey: ["assets"], queryFn: fetchAssets });
  const devices = useQuery({ queryKey: ["devices", "picker"], queryFn: fetchDevicesForPicker });
  // Whether this company uses the cartridges module, from the session — the same
  // fact the sidebar reads to decide whether the whole area exists.
  const partsEnabled = useSuspenseQuery(sessionQuery).data.modules.parts;

  const isJournal = definition.source === "journal";
  // The same cap the server applies, so the pickers show the window that will run.
  const capDays = MAX_CUSTOM_RANGE_DAYS[definition.source];

  const idOpts = (rows: { id: string; name: string }[] | undefined): SelectOption[] =>
    (rows ?? []).map((r) => ({ value: r.id, label: r.name }));
  const peopleOpts: SelectOption[] = (people.data ?? []).map((p) => ({
    value: p.userId,
    label: p.name,
    hint: p.departmentNames.join(", ") || undefined,
  }));
  // Assets flattened with their full path, so names that repeat across plants are
  // still distinguishable in a flat multi-select.
  const assetOpts: SelectOption[] = assetOptions(assets.data ?? []).map((a) => ({
    value: a.id,
    label: a.name,
    hint: a.path,
  }));
  const deviceOpts: SelectOption[] = (devices.data ?? []).map((d) => ({
    value: d.id,
    label: d.identifier ? `${d.name} (${d.identifier})` : d.name,
  }));

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Report options</h2>

      <Labeled label="Report on">
        <Select
          value={definition.source}
          // Switching source resets grouping — a journal grouping like "severity" is
          // meaningless for downtime or reliability — and re-applies the new source's
          // range cap, so the pickers keep showing the window that will run.
          onChange={(e) => {
            const source = e.target.value as ReportSource;
            patch({
              source,
              grouping: "none",
              ...cappedRange(definition.from, definition.to, MAX_CUSTOM_RANGE_DAYS[source]),
            });
          }}
        >
          {/* The cartridge sources are hidden where the company does not use the
              module — the same rule the sidebar follows. Offering a report whose
              every run 404s is worse than not offering it. */}
          {REPORT_SOURCES.filter((s) => partsEnabled || !isPartSource(s)).map((s) => (
            <option key={s} value={s}>
              {REPORT_SOURCE_LABELS[s]}
            </option>
          ))}
        </Select>
      </Labeled>

      <Labeled label="Date range">
        <Select
          value={definition.range}
          onChange={(e) => patch({ range: e.target.value as ReportRange })}
        >
          {REPORT_RANGES.map((r) => (
            <option key={r} value={r}>
              {REPORT_RANGE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Labeled>

      {definition.range === "custom" ? (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-2 gap-2">
            <Labeled label="From">
              <Input
                type="date"
                value={toDateInput(definition.from)}
                onChange={(e) =>
                  patch(cappedRange(fromDateInput(e.target.value), definition.to, capDays))
                }
              />
            </Labeled>
            <Labeled label="To">
              <Input
                type="date"
                // The stored `to` is the exclusive next-day boundary; the picker shows
                // the last day actually covered, which is what the user chose.
                value={toDateInputInclusive(definition.to)}
                onChange={(e) =>
                  patch(cappedRange(definition.from, fromDateInput(e.target.value, true), capDays))
                }
              />
            </Labeled>
          </div>
          <p className="text-xs text-muted-foreground">
            {`A custom range covers at most ${capDays === 31 ? "one month" : "one year"}; picking a wider span moves the start forward.`}
          </p>
        </div>
      ) : null}

      {/* Downtime and reliability scope to an asset subtree, chosen a level at a time. */}
      {definition.source === "downtime" || definition.source === "reliability" ? (
        <Labeled
          label="Asset"
          hint={
            definition.source === "reliability" && definition.monthly
              ? "The reliability trend is for one asset. Leave empty to use the first plant."
              : "Reports on this asset and everything under it. Leave empty for the whole company."
          }
        >
          <AssetCascadePicker
            assets={assets.data ?? []}
            value={definition.assetId ? [definition.assetId] : []}
            onChange={(ids) => patch({ assetId: ids[0] })}
            multiple={false}
          />
        </Labeled>
      ) : null}

      {/* Shift-source reports read one department's schedule. */}
      {isShiftSource(definition.source) ? (
        <Labeled label="Department" hint="The department whose schedule this report reads.">
          <Select
            value={definition.departmentId ?? ""}
            onChange={(e) => patch({ departmentId: e.target.value || null })}
          >
            <option value="">Choose a department…</option>
            {flattenDepartments(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </Labeled>
      ) : null}

      {/* The leaderboard is one list overall, or one per department. */}
      {definition.source === "leaderboard" ? (
        <Labeled label="Break down">
          <Select
            value={definition.grouping === "department" ? "department" : "none"}
            onChange={(e) => patch({ grouping: e.target.value as ReportGrouping })}
          >
            <option value="none">Everyone together</option>
            <option value="department">By department</option>
          </Select>
        </Labeled>
      ) : null}

      {/* Reliability can break down by asset, by month (a trend), or by device. */}
      {definition.source === "reliability" ? (
        <Labeled label="Break down">
          <Select
            value={definition.byDevice ? "device" : definition.monthly ? "month" : "asset"}
            onChange={(e) => {
              const v = e.target.value;
              patch({ monthly: v === "month" || undefined, byDevice: v === "device" || undefined });
            }}
          >
            <option value="asset">By asset</option>
            <option value="device">By device</option>
            <option value="month">By month (trend over the year)</option>
          </Select>
        </Labeled>
      ) : null}

      {/* Reliability is one row per asset — grouping does not apply. */}
      {definition.source === "downtime" ? (
        <Labeled label="Group by">
          <Select
            value={definition.grouping}
            onChange={(e) => patch({ grouping: e.target.value as ReportGrouping })}
          >
            {(["none", "asset", "date"] as ReportGrouping[]).map((g) => (
              <option key={g} value={g}>
                {REPORT_GROUPING_LABELS[g]}
              </option>
            ))}
          </Select>
        </Labeled>
      ) : null}

      {/* Cartridge reports narrow by the person who did the work. Offered only
          where it changes something: the register and the health reports have no
          person to narrow by, and a filter that does nothing reads as broken. */}
      {sourceSupportsPerson(definition.source) ? (
        <Labeled label="Serviced by">
          <MultiSelect
            values={filterValues("personId")}
            onChange={(v) => setFilter("personId", v)}
            options={peopleOpts}
            placeholder="Anyone"
          />
        </Labeled>
      ) : null}

      {!isJournal ? null : (
        <>
          <Labeled label="Group by">
            <Select
              value={definition.grouping}
              onChange={(e) => patch({ grouping: e.target.value as ReportGrouping })}
            >
              {REPORT_GROUPINGS.map((g) => (
                <option key={g} value={g}>
                  {REPORT_GROUPING_LABELS[g]}
                </option>
              ))}
            </Select>
          </Labeled>

          <Labeled label="Columns">
            <div className="flex flex-col gap-1">
              {REPORT_COLUMNS.map((col) => (
                <label key={col} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={definition.columns.includes(col)}
                    onChange={(e) =>
                      patch({ columns: toggleColumn(definition.columns, col, e.target.checked) })
                    }
                  />
                  {REPORT_COLUMN_LABELS[col]}
                </label>
              ))}
            </div>
          </Labeled>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Filters
            </h3>
            <FilterField label="Location">
              <MultiSelect
                values={filterValues("locationId")}
                onChange={(v) => setFilter("locationId", v)}
                options={idOpts(locations.data)}
                placeholder="Any location"
              />
            </FilterField>
            <FilterField label="Department">
              <MultiSelect
                values={filterValues("departmentId")}
                onChange={(v) => setFilter("departmentId", v)}
                options={idOpts(departments.data)}
                placeholder="Any department"
              />
            </FilterField>
            <FilterField label="Category">
              <MultiSelect
                values={filterValues("categoryId")}
                onChange={(v) => setFilter("categoryId", v)}
                options={idOpts(categories.data)}
                placeholder="Any category"
              />
            </FilterField>
            <FilterField label="Reported by">
              <MultiSelect
                values={filterValues("authorId")}
                onChange={(v) => setFilter("authorId", v)}
                options={peopleOpts}
                placeholder="Anyone"
              />
            </FilterField>
            <FilterField label="Assigned to">
              <MultiSelect
                values={filterValues("assigneeId")}
                onChange={(v) => setFilter("assigneeId", v)}
                options={peopleOpts}
                placeholder="Anyone"
              />
            </FilterField>
            <FilterField label="Severity">
              <MultiSelect
                values={filterValues("severityId")}
                onChange={(v) => setFilter("severityId", v)}
                options={idOpts(severities.data)}
                placeholder="Any severity"
              />
            </FilterField>
            <FilterField label="Status">
              <MultiSelect
                values={filterValues("statusId")}
                onChange={(v) => setFilter("statusId", v)}
                options={idOpts(statuses.data)}
                placeholder="Any status"
              />
            </FilterField>
            <FilterField label="Tag">
              <MultiSelect
                values={filterValues("tagId")}
                onChange={(v) => setFilter("tagId", v)}
                options={idOpts(tags.data)}
                placeholder="Any tag"
              />
            </FilterField>
            <FilterField label="Asset">
              <MultiSelect
                values={filterValues("assetId")}
                onChange={(v) => setFilter("assetId", v)}
                options={assetOpts}
                placeholder="Any asset"
              />
            </FilterField>
            <FilterField label="Device">
              <MultiSelect
                values={filterValues("deviceId")}
                onChange={(v) => setFilter("deviceId", v)}
                options={deviceOpts}
                placeholder="Any device"
              />
            </FilterField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={definition.filters.openOnly ?? false}
                onChange={(e) => setFlag("openOnly", e.target.checked)}
              />
              Only still-open (not resolved)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={definition.filters.recurring ?? false}
                onChange={(e) => setFlag("recurring", e.target.checked)}
              />
              Only recurring issues
            </label>
            <FilterField label="Kind">
              <Select
                value={definition.filters.kind ?? ""}
                onChange={(e) =>
                  patch({
                    filters: {
                      ...definition.filters,
                      kind: (e.target.value || undefined) as ReportDefinition["filters"]["kind"],
                    },
                  })
                }
              >
                <option value="">Any kind</option>
                <option value="issue">Issue</option>
                <option value="work">Work log</option>
              </Select>
            </FilterField>
          </div>
        </>
      )}
    </Card>
  );
}

/** A label + control stack. Div-based (not a <label>) so a checkbox group inside it
 *  never nests two labels. Replaces the shared `Field`, whose render-prop children
 *  do not fit the SearchableSelect or the checkbox lists used here. */
function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/* ------------------------------- metadata panel ---------------------------- */

function MetaPanel({
  name,
  setName,
  description,
  setDescription,
  access,
  setAccess,
  groupIds,
  setGroupIds,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  access: ReportViewAccess;
  setAccess: (v: ReportViewAccess) => void;
  groupIds: string[];
  setGroupIds: (v: string[]) => void;
}) {
  const groups = useQuery({ queryKey: ["groups", "picker"], queryFn: fetchGroupsForPicker });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">Report details</h2>
      <Labeled label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Monthly line report"
        />
      </Labeled>
      <Labeled label="Description" hint="Optional — shown on the Reports list.">
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Labeled>
      <Labeled label="Who can run it">
        <Select value={access} onChange={(e) => setAccess(e.target.value as ReportViewAccess)}>
          {REPORT_VIEW_ACCESS.map((a) => (
            <option key={a} value={a}>
              {REPORT_VIEW_ACCESS_LABELS[a]}
            </option>
          ))}
        </Select>
      </Labeled>
      {access === "groups" ? (
        <Labeled
          label="Shared with groups"
          hint="Each viewer still sees only their own scoped rows."
        >
          <div className="flex max-h-40 flex-col gap-1 overflow-auto rounded-lg border border-border p-2">
            {(groups.data ?? []).map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={groupIds.includes(g.id)}
                  onChange={(e) =>
                    setGroupIds(
                      e.target.checked ? [...groupIds, g.id] : groupIds.filter((id) => id !== g.id),
                    )
                  }
                />
                {g.name}
              </label>
            ))}
          </div>
        </Labeled>
      ) : null}
    </Card>
  );
}

/* ------------------------------- the report view --------------------------- */

function ReportView({ result, title }: { result: ReportResult; title: string }) {
  const { meta, groups, totals } = result;
  const grouped = meta.grouping !== "none" && meta.source !== "reliability";
  const cols = meta.columns;
  // Reliability counts assets, unless it is broken down by device or by month.
  const reliabilityNoun = cols.includes("device")
    ? "device"
    : cols.includes("month")
      ? "month"
      : "asset";
  const noun =
    meta.source === "downtime"
      ? "outage"
      : meta.source === "reliability"
        ? reliabilityNoun
        : meta.source === "leaderboard"
          ? "person"
          : meta.source === "shift_changes"
            ? "change"
            : meta.source === "shift_roster"
              ? "assignment"
              : meta.source === "shift_coverage"
                ? "slot"
                : meta.source === "shift_attendance"
                  ? "person"
                  : meta.source === "routine_log"
                    ? "completion"
                    : meta.source === "routine_compliance"
                      ? "person"
                      : "entry";
  const nounPlural = noun === "entry" ? "entries" : noun === "person" ? "people" : `${noun}s`;
  const totalMetric =
    meta.source === "leaderboard" && totals.points > 0
      ? ` · ${totals.points} points`
      : meta.source === "downtime" && totals.downtimeMinutes > 0
        ? ` · ${formatDurationMinutes(totals.downtimeMinutes)} down`
        : totals.durationMinutes > 0
          ? ` · ${formatDurationMinutes(totals.durationMinutes)}`
          : "";

  return (
    <Card className="report-page flex flex-col gap-3 p-6">
      <header className="border-b-2 border-foreground/70 pb-2">
        <h1 className="text-lg font-semibold">{meta.viewName ?? title}</h1>
        <p className="text-sm text-muted-foreground">
          {[
            meta.companyName,
            meta.assetName,
            `${formatDate(meta.from)} – ${formatDate(meta.toInclusive)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-xs text-muted-foreground">Generated {formatDate(meta.generatedAt)}</p>
      </header>

      {totals.count === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing matches this report in the chosen range.
        </p>
      ) : (
        <div className="report-scroll overflow-x-auto">
          <table className="report-table w-full border-collapse text-sm">
            <colgroup>
              {cols.map((c) => (
                <col key={c} style={{ width: `${columnWidthPct(c, cols)}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                {cols.map((c, i) => (
                  <th key={c} className="whitespace-normal px-2 py-1.5 font-medium">
                    {meta.columnLabels[i] ?? c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupBlock
                  key={group.key ?? group.label}
                  label={grouped ? group.label : null}
                  count={group.totals.count}
                  cols={cols}
                  rows={group.rows}
                />
              ))}
              <tr className="border-t-2 border-foreground/70 font-semibold">
                <td className="px-2 py-1.5" colSpan={cols.length}>
                  Total — {totals.count} {totals.count === 1 ? noun : nounPlural}
                  {totalMetric}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function GroupBlock({
  label,
  count,
  cols,
  rows,
}: {
  label: string | null;
  count: number;
  cols: string[];
  rows: ReportRow[];
}) {
  return (
    <>
      {label !== null ? (
        <tr className="bg-muted/60">
          <td className="px-2 py-1.5 font-semibold" colSpan={cols.length}>
            {label} <Badge tone="neutral">{count}</Badge>
          </td>
        </tr>
      ) : null}
      {rows.map((row) => (
        <tr key={row.id} className="border-b border-border/60 align-top">
          {cols.map((c) => (
            <td key={c} className="break-words px-2 py-1.5 [overflow-wrap:anywhere]">
              {row.cells[c] ?? ""}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* --------------------------------- helpers --------------------------------- */

// Relative column weights, so the free-text columns (description, work done, title)
// get the room they need and the short ones (date, points) stay narrow — the report
// then fits the page width and wraps instead of scrolling off the side.
const COLUMN_WEIGHT: Record<string, number> = {
  date: 1.1,
  kind: 0.9,
  title: 2.4,
  issueSummary: 3.2,
  workSummary: 3.2,
  category: 1.4,
  department: 1.4,
  location: 1.4,
  asset: 1.8,
  author: 1.4,
  assignee: 1.4,
  severity: 1,
  status: 1.1,
  duration: 1,
  age: 0.9,
  points: 0.8,
  reason: 2.2,
  start: 1.3,
  end: 1.3,
  downtime: 1.1,
  reporter: 1.4,
  failures: 0.9,
  open: 0.9,
  mttr: 1,
  mtbf: 1,
  availability: 1,
  month: 1.3,
  device: 1.8,
  rank: 0.5,
  person: 2.2,
  own: 0.9,
  team: 0.9,
};

function columnWidthPct(col: string, cols: string[]): number {
  const total = cols.reduce((sum, c) => sum + (COLUMN_WEIGHT[c] ?? 1), 0);
  return Math.round(((COLUMN_WEIGHT[col] ?? 1) / total) * 1000) / 10;
}

function toggleColumn(columns: string[], col: ReportColumn, on: boolean): string[] {
  const next = on ? [...columns, col] : columns.filter((c) => c !== col);
  // Keep the canonical column order regardless of click order, and never empty.
  const ordered: string[] = REPORT_COLUMNS.filter((c) => next.includes(c));
  return ordered.length > 0 ? ordered : [col];
}

/** A datetime ISO string → the yyyy-mm-dd a date input wants (local). */
function toDateInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
/** The exclusive `to` shown as the last day it actually covers (to − 1ms). */
export function toDateInputInclusive(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - 1);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** A date input value → an ISO instant. `end` pushes to the day's end (exclusive). */
function fromDateInput(value: string, end = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (end) d.setUTCDate(d.getUTCDate() + 1); // exclusive end of the chosen day
  return d.toISOString();
}

/**
 * Apply the server's custom-range cap in the picker, so the dates on screen are the
 * dates that will run. Over-long spans move the *start* forward, exactly as the
 * server does — the end the user chose is the one they keep.
 */
export function cappedRange(
  from: string | undefined,
  to: string | undefined,
  capDays: number,
): { from: string | undefined; to: string | undefined } {
  if (!from || !to) return { from, to };
  const capMs = capDays * 24 * 60 * 60 * 1000;
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return { from, to };
  if (toMs - fromMs > capMs) return { from: new Date(toMs - capMs).toISOString(), to };
  return { from, to };
}

/**
 * Print styling: hide the app chrome and controls, show only the report, and lay it
 * out on **A4 landscape** so a report with many columns fits the page instead of
 * being clipped with a scrollbar. The table is forced to the full page width with a
 * fixed layout, every cell wraps (no horizontal overflow), and the font shrinks so
 * long free-text columns — issue description, work done — stay on the page.
 */
function PrintStyle() {
  return (
    <style>{`
      @media print {
        @page { size: A4 landscape; margin: 10mm; }
        body * { visibility: hidden !important; }
        .report-print, .report-print * { visibility: visible !important; }
        /* On screen the report column scrolls; when printing it must not clip to one
           screenful, so overflow is forced back to visible. */
        .report-print { position: absolute; inset: 0; margin: 0; width: 100%; overflow: visible !important; }
        .report-page { border: none !important; box-shadow: none !important; padding: 0 !important; }
        .no-print { display: none !important; }
        /* The on-screen horizontal scroll must not become a clipped print area. */
        .report-scroll { overflow: visible !important; }
        .report-table { width: 100% !important; table-layout: fixed; font-size: 8.5pt; }
        .report-table th, .report-table td {
          white-space: normal !important;
          word-break: break-word;
          overflow-wrap: anywhere;
          vertical-align: top;
          padding: 2px 4px !important;
        }
        /* Keep a row intact across a page break where it can. */
        .report-table tr { page-break-inside: avoid; }
        .report-table thead { display: table-header-group; }
      }
    `}</style>
  );
}
