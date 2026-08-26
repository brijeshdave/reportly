// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reports — the list, above it the "My day" strip that makes the whole thing get
// used. The point of the feature is reporting from everyone, so the first thing you
// see is your own work: what you owe, and what you have earned.
import { PERMISSIONS, type JournalEntryRow, formatDate } from "@reportly/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { DATE_RANGE_PRESETS } from "@/lib/date-ranges.js";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
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

/**
 * The last seven days — the same range the "Last 7 days" button applies.
 *
 * Taken from the preset rather than computed here, because the filter stores full
 * ISO instants and renders them back in *local* time. A bare `YYYY-MM-DD` parses as
 * UTC midnight, so west of Greenwich the chip said one date and the date box below
 * it said the day before. Using the preset also means the button shows as active,
 * which is true: it is exactly what was applied.
 */
function lastWeek(): [string, string] {
  const preset = DATE_RANGE_PRESETS.find((candidate) => candidate.id === "7d");
  return (preset?.range(new Date()) ?? ["", ""]) as [string, string];
}

/**
 * What the journal opens on.
 *
 * Newest first, the last week, and the caller's direct reporting team — the
 * question people actually arrive with. It opened on every entry anyone could see,
 * in no particular order, which for a head of department is the whole organisation
 * back to the beginning.
 *
 * Defaults, not locks: every one of them is a normal filter, editable and
 * clearable like any other, and a link carrying its own filters wins.
 */
function defaultState() {
  return {
    sortBy: "reportDate",
    sortDir: "desc" as const,
    filters: [
      { field: "reportDate", op: "between" as const, value: lastWeek() },
      { field: "team", op: "eq" as const, value: "direct" },
    ],
  };
}

// A leaderboard link lands here with `?authorId=`, so the table opens filtered to
// that person's entries. That is a deliberate question about one person, so it
// replaces the team default rather than fighting it.
export function JournalListPage({ authorId }: { authorId?: string } = {}) {
  const navigate = useNavigate();
  const list = useListResource<JournalEntryRow>({
    // Its own slot when a link names one person, so "their entries" never inherits
    // the team view's filters — nor leaves them behind on the way out.
    resource: authorId ? `journal:author:${authorId}` : "journal",
    path: "/journal",
    initial: authorId
      ? { filters: [{ field: "authorId", op: "eq", value: authorId }] }
      : defaultState(),
  });

  /**
   * The lookup-fed filters are loaded when somebody asks for them.
   *
   * Seven of these fired on every visit to the journal — statuses, severities,
   * categories, tags, departments, locations and every person in the organisation —
   * purely to fill dropdowns in a panel most visits never open. Over a tunnel that
   * is seven round trips in front of the one request the page is actually for,
   * which is what "the journal page is very lagging" turned out to be with
   * forty-nine entries.
   *
   * They also load when a filter that needs them is already applied, so a chip
   * says "Critical" rather than showing a bare id while the panel stays shut.
   */
  const [filtersOpened, setFiltersOpened] = useState(false);
  const usesLookup = list.state.filters.some((filter) =>
    [
      "statusName",
      "severityName",
      "categoryId",
      "tag",
      "departmentId",
      "locationId",
      "authorId",
    ].includes(filter.field),
  );
  const wantOptions = filtersOpened || usesLookup;

  // Option lists for the select filters. The catalogues are small and cached, so a
  // filter offers exactly the values that exist rather than a free-text guess.
  const statuses = useQuery({
    queryKey: ["report-config", "statuses"],
    queryFn: fetchStatuses,
    enabled: wantOptions,
  });
  const severities = useQuery({
    queryKey: ["report-config", "severities"],
    queryFn: fetchSeverities,
    enabled: wantOptions,
  });
  const categories = useQuery({
    queryKey: ["report-config", "categories"],
    queryFn: () => fetchCategories(),
    enabled: wantOptions,
  });
  const tags = useQuery({
    queryKey: ["vocabulary", "tags"],
    queryFn: () => fetchTags(),
    enabled: wantOptions,
  });
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    enabled: wantOptions,
  });
  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: fetchLocations,
    enabled: wantOptions,
  });
  const people = useQuery({
    queryKey: ["org", "people"],
    queryFn: fetchOrgPeople,
    enabled: wantOptions,
  });

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
      {
        // Whose entries, by the reporting line. The names say what they mean to
        // the person reading them, not what the query does.
        field: "team",
        label: "Whose",
        kind: "select",
        options: [
          { value: "me", label: "Only mine" },
          { value: "direct", label: "My direct team" },
          { value: "two-levels", label: "Two levels down" },
          { value: "downline", label: "My whole team" },
          { value: "all", label: "Everyone I can see" },
        ],
      },
      {
        // "Has anybody looked at this yet." Not the score — scoring is blind
        // upward — but whether it is still sitting with a manager.
        field: "awaitingReview",
        label: "Review",
        kind: "select",
        options: [{ value: "true", label: "Not yet reviewed" }],
      },
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

      <div className="pt-4">
        <DataTable
          {...list}
          columns={columns}
          filterDefs={filterDefs}
          initialColumnVisibility={initialColumnVisibility}
          quickSearch={{ field: "search", placeholder: "Search by title or id" }}
          onFiltersOpen={() => setFiltersOpened(true)}
          emptyTitle="No entries yet"
          emptyDescription="Nothing in the last week from your team. Widen the date or the Whose filter."
        />
      </div>
    </>
  );
}
