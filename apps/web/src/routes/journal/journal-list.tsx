// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reports — the list, above it the "My day" strip that makes the whole thing get
// used. The point of the feature is reporting from everyone, so the first thing you
// see is your own work: what you owe, and what you have earned.
import { PERMISSIONS, type JournalEntryRow, formatDate } from "@reportly/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo } from "react";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { MyDay } from "@/components/my-day.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import { KindBadge, StateBadge, StatusBadge } from "@/components/report-badges.js";
import { TagList } from "@/components/tag-chip.js";
import { Button, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { departmentOptions } from "@/lib/department-options.js";
import { fetchCategories, fetchSeverities, fetchStatuses } from "@/services/journal-config.js";
import { fetchTags } from "@/services/vocabulary.js";
import { fetchDepartments, fetchOrgPeople } from "@/services/departments.js";
import { fetchLocations } from "@/services/locations.js";

const columns: TableColumn<JournalEntryRow>[] = [
  {
    id: "title",
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => (
      <Link
        to="/journal/$reportId"
        params={{ reportId: row.original.id }}
        className="font-medium text-foreground hover:underline"
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    id: "kind",
    accessorKey: "kind",
    header: "Kind",
    cell: ({ row }) => <KindBadge kind={row.original.kind} />,
  },
  {
    id: "statusName",
    accessorKey: "statusName",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge name={row.original.statusName} group={row.original.statusGroup} />
    ),
  },
  { id: "authorName", accessorKey: "authorName", header: "Author" },
  {
    id: "assigneeName",
    accessorKey: "assigneeName",
    header: "Assignee",
    cell: ({ row }) => row.original.assigneeName ?? "—",
  },
  {
    id: "severityName",
    accessorKey: "severityName",
    header: "Severity",
    cell: ({ row }) => row.original.severityName ?? "—",
  },
  {
    id: "categoryName",
    accessorKey: "categoryName",
    header: "Category",
    cell: ({ row }) => row.original.categoryName ?? "—",
  },
  {
    id: "departmentName",
    accessorKey: "departmentName",
    header: "Department",
    cell: ({ row }) => row.original.departmentName ?? "—",
  },
  {
    id: "locationName",
    accessorKey: "locationName",
    header: "Location",
    cell: ({ row }) => row.original.locationName ?? "—",
  },
  {
    id: "tags",
    header: "Tags",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.tags.length > 0 ? (
        <TagList tags={row.original.tags} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "state",
    accessorKey: "state",
    header: "State",
    cell: ({ row }) => <StateBadge state={row.original.state} />,
  },
  {
    id: "reportDate",
    accessorKey: "reportDate",
    header: "Date",
    cell: ({ row }) => formatDate(row.original.reportDate),
  },
];

// Kept out of the way until turned on from the Columns menu, so the default table
// stays readable while every field is still one click away.
const initialColumnVisibility = {
  assigneeName: false,
  severityName: false,
  categoryName: false,
  departmentName: false,
  locationName: false,
  tags: false,
};

// A leaderboard link lands here with `?authorId=`, so the table opens filtered to
// that person's entries. The filter is seeded once, then editable like any other.
// My day first, and the default: most visits are somebody checking what is on
// their plate rather than hunting a particular entry, and the tab is in the URL
// so a link to the table stays a link to the table.
const TABS = [
  { id: "today", label: "My day" },
  { id: "entries", label: "Entries" },
];

export function JournalListPage({
  authorId,
  tab = "today",
}: { authorId?: string; tab?: string } = {}) {
  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "today";
  const navigate = useNavigate();
  const list = useListResource<JournalEntryRow>({
    resource: "journal",
    path: "/journal",
    initial: authorId ? { filters: [{ field: "authorId", op: "eq", value: authorId }] } : undefined,
  });

  // Option lists for the select filters. The catalogues are small and cached, so a
  // filter offers exactly the values that exist rather than a free-text guess.
  const statuses = useQuery({ queryKey: ["report-config", "statuses"], queryFn: fetchStatuses });
  const severities = useQuery({
    queryKey: ["report-config", "severities"],
    queryFn: fetchSeverities,
  });
  const categories = useQuery({
    queryKey: ["report-config", "categories"],
    queryFn: () => fetchCategories(),
  });
  const tags = useQuery({ queryKey: ["vocabulary", "tags"], queryFn: () => fetchTags() });
  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const locations = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const people = useQuery({ queryKey: ["org", "people"], queryFn: fetchOrgPeople });

  const filterDefs = useMemo<FilterDef[]>(() => {
    // Finite, few options → a native select. Many options → a searchable combobox
    // keyed by id, so the same name in two places is never ambiguous.
    const nameOptions = (rows: { name: string }[] | undefined) =>
      (rows ?? []).map((r) => ({ value: r.name, label: r.name }));
    const idOptions = (rows: { id: string; name: string }[] | undefined) =>
      (rows ?? []).map((r) => ({ value: r.id, label: r.name }));
    const peopleOptions = (people.data ?? []).map((p) => ({
      value: p.userId,
      label: p.name,
      hint: p.departmentNames.join(", ") || undefined,
    }));

    return [
      { field: "reportDate", label: "Date", kind: "daterange" },
      { field: "title", label: "Title", kind: "text" },
      {
        field: "kind",
        label: "Kind",
        kind: "select",
        options: [
          { value: "issue", label: "Issue" },
          { value: "work", label: "Work log" },
        ],
      },
      { field: "statusName", label: "Status", kind: "select", options: nameOptions(statuses.data) },
      {
        field: "severityName",
        label: "Severity",
        kind: "select",
        options: nameOptions(severities.data),
      },
      {
        field: "categoryId",
        label: "Category",
        kind: "combobox",
        options: idOptions(categories.data),
      },
      {
        field: "tag",
        label: "Tag",
        kind: "combobox",
        options: idOptions(tags.data),
      },
      {
        field: "departmentId",
        label: "Department",
        kind: "combobox",
        // With its ancestors underneath: the filter list is searchable, and a name
        // on its own does not say where in the tree it sits.
        options: departmentOptions(
          (departments.data ?? []).map((d) => ({ value: d.id, name: d.name, path: d.path })),
        ),
      },
      {
        field: "locationId",
        label: "Location",
        kind: "combobox",
        options: idOptions(locations.data),
      },
      { field: "authorId", label: "Author", kind: "combobox", options: peopleOptions },
      { field: "assigneeId", label: "Assignee", kind: "combobox", options: peopleOptions },
      {
        field: "state",
        label: "State",
        kind: "select",
        options: [
          { value: "draft", label: "Draft" },
          { value: "submitted", label: "Submitted" },
        ],
      },
    ];
  }, [
    statuses.data,
    severities.data,
    categories.data,
    tags.data,
    departments.data,
    locations.data,
    people.data,
  ]);

  return (
    <>
      <PageHeader
        title="Journal"
        description="Everyone logs their issues and work here. Your managers see and score what you submit; you see your own, and everyone below you in the reporting line."
        actions={
          <Can permission={PERMISSIONS.JOURNAL_CREATE}>
            <Button size="sm" onClick={() => void navigate({ to: "/journal/new" })}>
              <Plus className="h-4 w-4" />
              New entry
            </Button>
          </Can>
        }
      />

      {/* The table and the day's summary were stacked, which meant scrolling
          past a screenful of tiles to reach the thing most people came for. They
          answer different questions — "what is on my plate today" and "find me
          that entry" — so they are two views rather than one long page. */}
      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void navigate({ to: "/journal", search: { authorId, tab: id } })}
      />

      <TabPanel id="entries" active={activeTab}>
        <div className="pt-4">
          <DataTable
            {...list}
            columns={columns}
            filterDefs={filterDefs}
            initialColumnVisibility={initialColumnVisibility}
            emptyTitle="No entries yet"
            emptyDescription="File your first entry to get started."
          />
        </div>
      </TabPanel>

      <TabPanel id="today" active={activeTab}>
        <div className="pt-4">
          <MyDay />
        </div>
      </TabPanel>
    </>
  );
}
