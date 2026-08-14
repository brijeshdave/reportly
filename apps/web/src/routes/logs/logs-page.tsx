// Author: Brijesh Dave <https://github.com/brijeshdave>
// Log viewer: a searchable table whose rows open into full detail, and a live tail
// rendered as a console. A row summarises a line; the detail drawer shows the rich
// context the row cannot — the method, url, status and timing an HTTP line carries
// but that a bare "incoming request" hides.
import { LOG_LEVELS, type LogEntry, formatDate, formatDateTime } from "@reportly/shared";
import { useState } from "react";

import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { PageTabs } from "@/components/page-tabs.js";
import { PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { useNavigate } from "@tanstack/react-router";
import { formatRequestSummary, requestSummary } from "@/lib/log-format.js";
import { LevelBadge } from "@/routes/logs/level-badge.js";
import { LogDetail } from "@/routes/logs/log-detail.js";
import { LogTail } from "@/routes/logs/log-tail.js";
import type { RequestSummary } from "@/lib/log-format.js";

/** A hidden-by-default column reading one field of a line's request summary. */
function reqColumn(
  id: string,
  header: string,
  read: (summary: RequestSummary) => unknown,
): TableColumn<LogEntry> {
  return {
    id,
    header,
    enableSorting: false,
    cell: ({ row }) => {
      const summary = requestSummary(row.original);
      const value = summary ? read(summary) : null;
      return value === null || value === undefined ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="whitespace-nowrap font-mono text-xs">{String(value)}</span>
      );
    },
  };
}

const columns: TableColumn<LogEntry>[] = [
  {
    id: "ts",
    accessorKey: "ts",
    header: "Time",
    cell: ({ row }) => {
      const date = new Date(row.original.ts);
      return (
        <div className="whitespace-nowrap">
          <div className="text-sm">{date.toLocaleTimeString()}</div>
          <div className="text-xs text-muted-foreground">{formatDate(date)}</div>
        </div>
      );
    },
  },
  {
    id: "level",
    accessorKey: "level",
    header: "Level",
    cell: ({ row }) => <LevelBadge level={row.original.level} />,
  },
  { id: "feature", accessorKey: "feature", header: "Feature" },
  {
    id: "msg",
    accessorKey: "msg",
    header: "Message",
    enableSorting: false,
    cell: ({ row }) => {
      const summary = requestSummary(row.original);
      return (
        <div className="min-w-0 max-w-xl">
          <div className="truncate">{row.original.msg}</div>
          {summary ? (
            <div className="truncate font-mono text-xs text-muted-foreground">
              {formatRequestSummary(summary)}
            </div>
          ) : null}
        </div>
      );
    },
  },
  {
    id: "requestId",
    accessorKey: "requestId",
    header: "Request",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.requestId ? (
        <code className="text-xs text-muted-foreground">{row.original.requestId.slice(0, 8)}</code>
      ) : null,
  },
  {
    id: "userId",
    accessorKey: "userId",
    header: "User",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.userId ? (
        <code className="text-xs text-muted-foreground">{row.original.userId.slice(0, 8)}</code>
      ) : null,
  },
  {
    id: "companyId",
    accessorKey: "companyId",
    header: "Company",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.companyId ? (
        <code className="text-xs text-muted-foreground">{row.original.companyId.slice(0, 8)}</code>
      ) : null,
  },
  // The request fields, each as its own column for when you want to sort a glance
  // across many lines. Off by default — the Message column already summarises them.
  reqColumn("method", "Method", (s) => s.method),
  reqColumn("url", "URL", (s) => s.url),
  reqColumn("status", "Status", (s) => (s.status === undefined ? null : s.status)),
  reqColumn("duration", "Duration", (s) =>
    s.durationMs === undefined ? null : `${s.durationMs}ms`,
  ),
];

// Trace ids and the per-field request columns are noise until wanted; a Columns
// click away.
const initialColumnVisibility = {
  requestId: false,
  userId: false,
  companyId: false,
  method: false,
  url: false,
  status: false,
  duration: false,
};

const filterDefs: FilterDef[] = [
  { field: "ts", label: "Date range", kind: "daterange" },
  {
    field: "level",
    label: "Level",
    kind: "select",
    options: LOG_LEVELS.map((level) => ({ value: level, label: level })),
  },
  { field: "feature", label: "Feature", kind: "text" },
  { field: "msg", label: "Message", kind: "text" },
  { field: "requestId", label: "Request ID", kind: "text", op: "eq" },
  { field: "userId", label: "User ID", kind: "text", op: "eq" },
];

const TABS = [
  { id: "search", label: "Search" },
  { id: "tail", label: "Live tail" },
];

export function LogsPage({ tab, requestId }: { tab: string; requestId?: string }) {
  const navigate = useNavigate({ from: "/logs" });
  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "search";

  return (
    <>
      <PageHeader
        title="Logs"
        description="Every request, job and browser error, tagged with the id that traces it end to end."
      />

      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void navigate({ search: { tab: id }, replace: true })}
      />

      <div className="pt-6">
        {activeTab === "search" ? <LogSearch requestId={requestId} /> : <LogTail />}
      </div>
    </>
  );
}

function LogSearch({ requestId }: { requestId?: string }) {
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const list = useListResource<LogEntry>({
    resource: "logs",
    path: "/logs",
    exportPath: "/logs/export",
    // A requestId in the URL (a deep link from an audit event) opens the table
    // already filtered to that one request's lines.
    initial: {
      sortBy: "ts",
      sortDir: "desc",
      filters: requestId ? [{ field: "requestId", op: "eq", value: requestId }] : [],
    },
  });

  return (
    <>
      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        initialColumnVisibility={initialColumnVisibility}
        onRowClick={setSelected}
        emptyTitle="No log lines"
        emptyDescription="Nothing matches yet."
        renderCard={(entry) => {
          const summary = requestSummary(entry);
          return (
            <button
              type="button"
              onClick={() => setSelected(entry)}
              className="flex w-full flex-col gap-1 text-left"
            >
              <div className="flex items-center gap-2">
                <LevelBadge level={entry.level} />
                <span className="text-xs text-muted-foreground">{entry.feature}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDateTime(entry.ts)}
                </span>
              </div>
              <p className="text-sm">{entry.msg}</p>
              {summary ? (
                <p className="font-mono text-xs text-muted-foreground">
                  {formatRequestSummary(summary)}
                </p>
              ) : null}
            </button>
          );
        }}
      />

      {selected ? <LogDetail entry={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}
