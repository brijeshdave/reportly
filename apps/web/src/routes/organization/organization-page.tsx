// Author: Brijesh Dave <https://github.com/brijeshdave>
// The organisation chart. Pan by dragging, zoom with the wheel or the buttons,
// collapse a branch to fold a team away, and filter down to a department or to one
// person's subtree.
//
// It is drawn from the same reporting edges that decide who may see whose reports,
// so this page is also the check on them: a line that looks wrong here *is* wrong,
// and you can see it before it is deciding anything.
import { type OrgChartNode } from "@reportly/shared";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Download,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Workflow,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";

import { Avatar } from "@/components/avatar.js";
import { sessionQuery } from "@/lib/queries.js";
import { Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { buildForest, subtreeOf, type ChartNode } from "@/routes/organization/org-chart.js";
import { downloadFile, orgToCsv, orgToHtml, printHtml } from "@/routes/organization/export-org.js";
import { fetchDepartments, fetchOrgChart } from "@/services/departments.js";

const RANK_LABEL: Record<string, string> = {
  hod: "HOD",
  lead: "Team leader",
  member: "Member",
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

export function OrganizationPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const companyName = session.companies.find((c) => c.id === session.companyId)?.name;

  return (
    <>
      <PageHeader
        title="Organisation"
        description={
          companyName
            ? `Who reports to whom in ${companyName}. This is the line that decides who can see whose reports.`
            : "Who reports to whom."
        }
      />

      {session.companyId ? (
        <Chart key={session.companyId} companyName={companyName} />
      ) : (
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher to see its organisation."
        />
      )}
    </>
  );
}

function Chart({ companyName }: { companyName: string | undefined }) {
  const chart = useQuery({ queryKey: ["departments", "org-chart"], queryFn: fetchOrgChart });
  const departments = useQuery({ queryKey: ["departments", "list"], queryFn: fetchDepartments });

  const [departmentId, setDepartmentId] = useState("");
  const [focusUserId, setFocusUserId] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragFrom = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => chart.data ?? [], [chart.data]);

  // Filters narrow the *set*; the forest is then rebuilt from what survives, so a
  // subtree whose manager was filtered out is drawn from its own top rather than
  // vanishing.
  const forest = useMemo(() => {
    let visible: OrgChartNode[] = nodes;
    if (focusUserId) visible = subtreeOf(visible, focusUserId);
    if (departmentId) visible = visible.filter((node) => node.departmentId === departmentId);
    return buildForest(visible);
  }, [nodes, focusUserId, departmentId]);

  const people = useMemo(
    () =>
      [...new Map(nodes.map((node) => [node.userId, node])).values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [nodes],
  );

  if (chart.isLoading || departments.isLoading) return <Spinner />;
  if (chart.error) return <ErrorAlert error={chart.error} />;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const collapseAll = () => {
    const withChildren = new Set<string>();
    const walk = (list: ChartNode[]) => {
      for (const node of list) {
        if (node.children.length > 0) withChildren.add(node.id);
        walk(node.children);
      }
    };
    walk(forest);
    setCollapsed(withChildren);
  };

  /** Zoom about the pointer, so the thing under the cursor stays under the cursor. */
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!viewport.current) return;
    event.preventDefault();

    const box = viewport.current.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;

    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const ratio = next / zoom;
    setPan({ x: px - (px - pan.x) * ratio, y: py - (py - pan.y) * ratio });
    setZoom(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Only drag the canvas itself — a click on a node's link or button is theirs.
    if ((event.target as HTMLElement).closest("a,button")) return;
    dragFrom.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    if (!from) return;
    setPan({ x: from.panX + (event.clientX - from.x), y: from.panY + (event.clientY - from.y) });
  };

  const endDrag = () => {
    dragFrom.current = null;
  };

  /** Scale the whole chart to fit, and centre it. */
  const fit = () => {
    if (!viewport.current || !canvas.current) return;
    const view = viewport.current.getBoundingClientRect();
    // The canvas is transformed, so its laid-out size must be read back out of it.
    const width = canvas.current.scrollWidth;
    const height = canvas.current.scrollHeight;
    if (width === 0 || height === 0) return;

    const next = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(view.width / width, view.height / height) * 0.9),
    );
    setZoom(next);
    setPan({ x: (view.width - width * next) / 2, y: 24 });
  };

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCollapsed(new Set());
  };

  /**
   * Exports carry what is on screen — the filters are part of what you meant. The
   * collapse state is not: folding a branch away is a way of looking at the chart,
   * not a claim that those people are gone, and an export missing half the
   * organisation because a branch happened to be shut would be a quiet lie.
   */
  const exportTitle = `Organisation — ${companyName ?? "chart"}`;
  const stamp = new Date().toISOString().slice(0, 10);

  const exportHtml = async () => {
    const html = await orgToHtml(forest, exportTitle);
    downloadFile(html, `organisation-${stamp}.html`, "text/html");
  };

  const exportPdf = async () => {
    // The browser's own print engine: vector output, real pagination, and no
    // rasteriser dependency of ours to keep up to date.
    printHtml(await orgToHtml(forest, exportTitle));
  };

  const exportCsv = () => {
    downloadFile(orgToCsv(forest), `organisation-${stamp}.csv`, "text/csv");
  };

  const needle = search.trim().toLowerCase();
  const matches = (node: ChartNode) =>
    needle !== "" &&
    (node.name.toLowerCase().includes(needle) ||
      (node.designation ?? "").toLowerCase().includes(needle) ||
      node.email.toLowerCase().includes(needle));

  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title="No reporting line yet"
        description="Add people to a department and say who they report to — the chart draws itself from that."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Department</span>
          <select
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            aria-label="Department"
            className="h-9 rounded-xl border border-border bg-card px-3 text-sm"
          >
            <option value="">All departments</option>
            {(departments.data ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Focus on</span>
          <select
            value={focusUserId}
            onChange={(event) => setFocusUserId(event.target.value)}
            aria-label="Focus on"
            className="h-9 rounded-xl border border-border bg-card px-3 text-sm"
          >
            <option value="">Everyone</option>
            {people.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Highlight</span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, job title or email"
            aria-label="Highlight"
          />
        </label>

        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={collapseAll} title="Collapse every branch">
            Collapse all
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCollapsed(new Set())}>
            Expand all
          </Button>

          <ExportMenu onPdf={exportPdf} onHtml={exportHtml} onCsv={exportCsv} />
        </div>
      </Card>

      <Card className="relative overflow-hidden p-0">
        {/* Zoom controls float over the canvas so they survive any pan. */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-xl border border-border bg-card/90 p-1 shadow-sm backdrop-blur">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.2))}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2))}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Fit to screen" onClick={fit}>
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Reset view" onClick={reset}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        <div
          ref={viewport}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="h-[68vh] cursor-grab touch-none overflow-hidden bg-muted/20 active:cursor-grabbing"
        >
          <div
            ref={canvas}
            className="inline-block origin-top-left p-8"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <div className="flex items-start gap-10">
              {forest.map((root) => (
                <Branch
                  key={root.id}
                  node={root}
                  collapsed={collapsed}
                  onToggle={toggle}
                  matches={matches}
                />
              ))}
            </div>
          </div>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Drag to pan, scroll to zoom. {forest.length === 0 ? "Nothing matches these filters." : null}
      </p>
    </div>
  );
}

/**
 * The export menu. Three formats, because they answer different questions:
 * a PDF to hand to somebody, an HTML file that keeps its faces and opens anywhere,
 * and a CSV for the questions a picture cannot answer.
 */
function ExportMenu({
  onPdf,
  onHtml,
  onCsv,
}: {
  onPdf: () => Promise<void>;
  onHtml: () => Promise<void>;
  onCsv: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (task: () => void | Promise<void>) => {
    setOpen(false);
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)} disabled={busy}>
        {busy ? <Spinner /> : <Download className="h-4 w-4" />}
        Export
      </Button>

      {open ? (
        <>
          {/* Click anywhere else to dismiss, rather than trapping the pointer. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
            <button
              type="button"
              onClick={() => void run(onPdf)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              PDF
              <span className="block text-xs text-muted-foreground">
                Opens your print dialog — choose “Save as PDF”.
              </span>
            </button>
            <button
              type="button"
              onClick={() => void run(onHtml)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              HTML
              <span className="block text-xs text-muted-foreground">
                One self-contained file, pictures included.
              </span>
            </button>
            <button
              type="button"
              onClick={() => run(onCsv)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              CSV
              <span className="block text-xs text-muted-foreground">
                One row per person, for a spreadsheet.
              </span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** One node and, unless folded away, everything under it. */
function Branch({
  node,
  collapsed,
  onToggle,
  matches,
}: {
  node: ChartNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  matches: (node: ChartNode) => boolean;
}) {
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        node={node}
        highlighted={matches(node)}
        collapsed={isCollapsed}
        hasChildren={hasChildren}
        onToggle={() => onToggle(node.id)}
      />

      {hasChildren && !isCollapsed ? (
        <>
          {/* The stem down from this node into the rail joining its reports. */}
          <div className="h-6 w-px bg-border" />

          {/*
            The rail is drawn as two halves per child rather than one line across
            the row. A child that has its own reports is wider than its card, so
            "inset by half a card" would overhang the outermost two — the halves
            meet at each child's centre whatever width the child turns out to be.
            Spacing is padding, not a gap, so the halves stay continuous.
          */}
          <div className="flex items-start">
            {node.children.map((child, index) => (
              <div key={child.id} className="relative flex flex-col items-center px-3 pt-6">
                {index > 0 ? <span className="absolute left-0 top-0 h-px w-1/2 bg-border" /> : null}
                {index < node.children.length - 1 ? (
                  <span className="absolute right-0 top-0 h-px w-1/2 bg-border" />
                ) : null}
                {/* The drop from the rail into this child. */}
                <span className="absolute left-1/2 top-0 h-6 w-px bg-border" />

                <Branch node={child} collapsed={collapsed} onToggle={onToggle} matches={matches} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NodeCard({
  node,
  highlighted,
  collapsed,
  hasChildren,
  onToggle,
}: {
  node: ChartNode;
  highlighted: boolean;
  collapsed: boolean;
  hasChildren: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`relative flex w-60 flex-col items-center gap-1 rounded-2xl border bg-card p-3 text-center shadow-sm transition-colors ${
        highlighted ? "border-primary ring-2 ring-primary/40" : "border-border"
      } ${node.status === "inactive" ? "opacity-60" : ""}`}
    >
      <Avatar userId={node.userId} name={node.name} version={node.avatarVersion} size="lg" />

      <Link
        to="/users/$userId"
        params={{ userId: node.userId }}
        className="mt-1 truncate text-sm font-semibold hover:underline"
      >
        {node.name}
      </Link>

      {node.designation ? (
        <p className="truncate text-xs text-muted-foreground">{node.designation}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-1">
        <Badge tone={node.rank === "hod" ? "brand" : "neutral"}>{RANK_LABEL[node.rank]}</Badge>
        <span className="truncate text-[10px] text-muted-foreground">{node.departmentName}</span>
      </div>

      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.name}`}
          className="absolute -bottom-3 flex items-center gap-0.5 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium shadow-sm hover:bg-muted"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {node.descendants}
        </button>
      ) : null}
    </div>
  );
}
