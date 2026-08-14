// Author: Brijesh Dave <https://github.com/brijeshdave>
// Field-level change history for one entity, reused by every detail page. The
// route is `/history/:entityType/:id` rather than `/:entity/:id/history`, which
// `/settings/:namespace/:key` shadows.
import { formatDateTime } from "@reportly/shared";
import type { EntityHistory, TrackedEntity } from "@reportly/shared";

import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import { useListResource } from "@/hooks/use-list-resource.js";

/** `null` reads as "not set" rather than as the string "null". */
function renderValue(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">not set</span>;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{text}</code>;
}

const columns: TableColumn<EntityHistory>[] = [
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "When",
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
  { id: "field", accessorKey: "field", header: "Field" },
  {
    id: "oldValue",
    accessorKey: "oldValue",
    header: "From",
    enableSorting: false,
    cell: ({ row }) => renderValue(row.original.oldValue),
  },
  {
    id: "newValue",
    accessorKey: "newValue",
    header: "To",
    enableSorting: false,
    cell: ({ row }) => renderValue(row.original.newValue),
  },
  {
    id: "actorId",
    accessorKey: "actorId",
    header: "Changed by",
    cell: ({ row }) => row.original.actorId ?? "system",
  },
];

export function HistoryTab({ entityType, id }: { entityType: TrackedEntity; id: string }) {
  const list = useListResource<EntityHistory>({
    resource: `history-${entityType}-${id}`,
    path: `/history/${entityType}/${id}`,
    initial: { sortBy: "createdAt", sortDir: "desc" },
  });

  return (
    <DataTable
      {...list}
      columns={columns}
      emptyTitle="No changes recorded"
      emptyDescription="Edits to this record will appear here."
      renderCard={(entry) => (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{entry.field}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(entry.createdAt)} · {entry.actorId ?? "system"}
          </p>
          <p className="text-xs">
            {renderValue(entry.oldValue)} → {renderValue(entry.newValue)}
          </p>
        </div>
      )}
    />
  );
}
