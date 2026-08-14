// Author: Brijesh Dave <https://github.com/brijeshdave>
// The Reports landing: the report views the caller may run, grouped into domain tabs
// (Journal, Downtime, … Scheduling) with a search box, so a growing library stays
// navigable. Each card is clickable as a whole — it runs the report — with the manage
// actions (clone/edit/delete) layered above the card's stretched link. System views are
// shipped (run or clone only); custom views are the company's own.
import {
  PERMISSIONS,
  REPORT_DOMAINS,
  reportDomain,
  type ReportDomain,
  type ReportView,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Copy, FileBarChart, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { SegmentedTabs } from "@/components/segmented-tabs.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { cloneReportView, deleteReportView, fetchReportViews } from "@/services/reports.js";

type Tab = "All" | ReportDomain;

export function ReportsListPage() {
  const canManage = usePermission(PERMISSIONS.REPORTS_MANAGE);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const views = useQuery({ queryKey: ["report-views"], queryFn: fetchReportViews });
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<ReportView | null>(null);

  const clone = useMutation({
    mutationFn: (view: ReportView) => cloneReportView(view.id, { name: `${view.name} copy` }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["report-views"] });
      await navigate({ to: "/reports/$viewId/edit", params: { viewId: created.id } });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteReportView(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["report-views"] }),
  });

  const all = views.data ?? [];
  // Tabs = "All" plus every domain that actually has a report, in the canonical
  // order. Read from REPORT_DOMAINS rather than a list repeated here: this was a
  // hardcoded array, and every domain added after it was written — Routines, then
  // Cartridges — silently had no tab. The reports were reachable under All and
  // nowhere else, which looks exactly like the feature not being built.
  const domains = useMemo(() => {
    const present = new Set(all.map((v) => reportDomain(v.definition.source)));
    return REPORT_DOMAINS.filter((domain) => present.has(domain));
  }, [all]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((v) => {
      if (tab !== "All" && reportDomain(v.definition.source) !== tab) return false;
      if (term) {
        const hay = `${v.name} ${v.description ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [all, tab, search]);

  const system = filtered.filter((v) => v.isSystem);
  const custom = filtered.filter((v) => !v.isSystem);

  const cardProps = {
    canManage,
    onClone: (v: ReportView) => clone.mutate(v),
    onDelete: setConfirmDelete,
    cloning: clone.isPending,
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Run a report on screen, print it to A4, or download it as Excel or HTML. Start from a ready-made report, or build your own."
        actions={
          canManage ? (
            <Button onClick={() => navigate({ to: "/reports/new" })}>
              <Plus className="mr-1.5 h-4 w-4" />
              New report
            </Button>
          ) : undefined
        }
      />

      {views.isLoading ? <Spinner /> : null}
      {views.error ? <ErrorAlert error={views.error} /> : null}

      <div className="flex flex-col gap-4 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedTabs
            ariaLabel="Filter by area"
            value={tab}
            onChange={setTab}
            segments={(["All", ...domains] as Tab[]).map((t) => ({ value: t, label: t }))}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search reports"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports…"
              className="h-8 w-56 pl-7"
            />
          </div>
        </div>

        {!views.isLoading && filtered.length === 0 ? (
          <EmptyState
            icon={FileBarChart}
            title="Nothing here"
            description={
              all.length === 0 ? "No reports yet." : "No reports match — try another tab or search."
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            <Section
              title="Ready-made reports"
              hint="Shipped with Reportly. Run as-is, or clone one to tailor it."
              views={system}
              {...cardProps}
            />
            <Section
              title="Your reports"
              hint="Custom reports you or your team saved."
              views={custom}
              {...cardProps}
              emptyLabel={
                tab === "All" || tab === "Scheduling"
                  ? undefined
                  : "No custom reports in this area yet."
              }
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.name}”?`}
        description="This removes the saved report for everyone it was shared with. It cannot be undone."
        confirmLabel="Delete report"
        destructive
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete.id);
        }}
      />
    </>
  );
}

function Section({
  title,
  hint,
  views,
  canManage,
  onClone,
  onDelete,
  cloning,
  emptyLabel,
}: {
  title: string;
  hint: string;
  views: ReportView[];
  canManage: boolean;
  onClone: (view: ReportView) => void;
  onDelete: (view: ReportView) => void;
  cloning: boolean;
  emptyLabel?: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {views.length === 0 ? (
        emptyLabel ? (
          <EmptyState icon={FileBarChart} title="Nothing here yet" description={emptyLabel} />
        ) : null
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {views.map((view) => (
            <ReportCard
              key={view.id}
              view={view}
              canManage={canManage}
              onClone={onClone}
              onDelete={onDelete}
              cloning={cloning}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReportCard({
  view,
  canManage,
  onClone,
  onDelete,
  cloning,
}: {
  view: ReportView;
  canManage: boolean;
  onClone: (view: ReportView) => void;
  onDelete: (view: ReportView) => void;
  cloning: boolean;
}) {
  return (
    <Card className="group relative flex cursor-pointer flex-col gap-2 p-4 transition hover:border-primary/50 hover:shadow-sm">
      {/* Stretched link: clicking anywhere on the card runs the report. The manage
          buttons sit above it (relative z-10), so they act instead of navigating. */}
      <Link
        to="/reports/$viewId"
        params={{ viewId: view.id }}
        aria-label={`Run ${view.name}`}
        className="absolute inset-0 rounded-xl"
      />
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <FileBarChart className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{view.name}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="line-clamp-2 min-h-[2rem] text-xs text-muted-foreground">
        {view.description ?? "—"}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{reportDomain(view.definition.source)}</Badge>
        {view.isSystem ? <Badge tone="neutral">System</Badge> : null}
      </div>
      <div className="relative z-10 mt-1 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onClone(view)}
          disabled={cloning || !canManage}
          title={canManage ? "Clone into an editable copy" : "Needs report management access"}
        >
          <Copy className="mr-1 h-3.5 w-3.5" />
          Clone
        </Button>
        {canManage && !view.isSystem ? (
          <>
            <Link to="/reports/$viewId/edit" params={{ viewId: view.id }}>
              <Button size="sm" variant="secondary">
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
            <Button size="sm" variant="ghost" onClick={() => onDelete(view)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );
}
