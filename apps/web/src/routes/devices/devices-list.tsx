// Author: Brijesh Dave <https://github.com/brijeshdave>
// The device registry — the many. Deliberately a searchable table and not a tree:
// there can be thousands of machines, and no one is going to file them into a
// hierarchy by hand. Each one records where it lives instead, which is what lets
// "issues under Line 3" still find it.
import { PERMISSIONS, type Device } from "@reportly/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, Download, Plus, Upload } from "lucide-react";

import { Can } from "@/components/can.js";
import { DeviceImportDialog } from "@/routes/devices/device-import-dialog.js";
import { exportDevices } from "@/services/assets.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { sessionQuery } from "@/lib/queries.js";
import { Badge, Button, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { useOptions } from "@/hooks/use-options.js";

const columns: TableColumn<Device>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Device",
    cell: ({ row }) => (
      <Link
        to="/devices/$deviceId/edit"
        params={{ deviceId: row.original.id }}
        className="font-medium text-foreground hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: "assetTag",
    accessorKey: "assetTag",
    header: "Asset ID",
    // The organisation's own identifier, and unique within the company — so it is
    // the column somebody scanning for a particular machine actually reads.
    // Sortable because the server indexes it; `identifier` beside it is free text.
    cell: ({ row }) =>
      row.original.assetTag ? (
        <span className="font-mono text-xs">{row.original.assetTag}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "identifier",
    accessorKey: "identifier",
    header: "Tag / serial",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.identifier ?? "—"}</span>,
  },
  {
    id: "typeName",
    accessorKey: "typeName",
    header: "Type",
    // Not sortable: the server's list config sorts on the device's own columns, and
    // this one is a joined name. A header that offered a sort the API would refuse
    // is worse than a header that does not offer one.
    enableSorting: false,
    cell: ({ row }) => row.original.typeName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "assetName",
    accessorKey: "assetName",
    header: "Lives at",
    enableSorting: false,
    cell: ({ row }) => row.original.assetName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "locationName",
    accessorKey: "locationName",
    header: "Site",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.locationName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "departmentName",
    accessorKey: "departmentName",
    header: "Department",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.departmentName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge tone={row.original.status === "active" ? "success" : "neutral"}>
        {row.original.status === "active" ? "active" : "retired"}
      </Badge>
    ),
  },
];

/**
 * The registry is asked questions about *where* a device is at least as often as
 * what it is called, and the API has always been able to answer them — `assetId`,
 * `departmentId` and `locationId` are filterable columns. The page simply never
 * offered them, so the only way to see one department's machines was to read the
 * whole table.
 */
function filterDefsFor(
  departments: { id: string; name: string }[],
  locations: { id: string; name: string }[],
  assets: { id: string; name: string }[],
): FilterDef[] {
  const options = (rows: { id: string; name: string }[]) =>
    rows.map((row) => ({ value: row.id, label: row.name }));

  return [
    { field: "name", label: "Device", kind: "text" },
    // Both identifiers are filterable server-side, and people search by whichever
    // one their organisation actually stencils on the machine.
    { field: "assetTag", label: "Asset tag", kind: "text" },
    { field: "identifier", label: "Tag / serial", kind: "text" },
    {
      field: "status",
      label: "Status",
      kind: "select",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Retired" },
      ],
    },
    // Comboboxes rather than selects: an installation has a handful of companies
    // and hundreds of assets, and the same name can appear in two places, so the
    // id is what travels.
    { field: "departmentId", label: "Department", kind: "combobox", options: options(departments) },
    { field: "locationId", label: "Location", kind: "combobox", options: options(locations) },
    { field: "assetId", label: "Asset", kind: "combobox", options: options(assets) },
    { field: "createdAt", label: "Added", kind: "daterange" },
  ];
}

export function DevicesListPage() {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const { data: session } = useSuspenseQuery(sessionQuery);
  const list = useListResource<Device>({ resource: "devices", path: "/devices" });

  const departments = useOptions<{ id: string; name: string }>("departments", "/departments");
  const locations = useOptions<{ id: string; name: string }>("locations", "/locations");
  const assets = useOptions<{ id: string; name: string }>("assets", "/assets");
  const filterDefs = useMemo(
    () => filterDefsFor(departments.data ?? [], locations.data ?? [], assets.data ?? []),
    [departments.data, locations.data, assets.data],
  );

  // The registry belongs to a company; without one the request can only 400.
  if (!session.companyId) {
    return (
      <>
        <PageHeader
          title="Devices"
          description="Every machine, sensor and instrument you report on."
        />
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher to see and manage its devices."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Devices"
        description="Every machine, sensor and instrument you report on. Search it rather than browse it — and give each one the asset it stands at, so issues roll up to the line without anyone maintaining a second tree."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportDevices()}>
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Can permission={PERMISSIONS.DEVICES_IMPORT}>
              <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
                <Upload className="h-4 w-4" />
                Import
              </Button>
            </Can>
            <Can permission={PERMISSIONS.DEVICES_CREATE}>
              <Button size="sm" onClick={() => void navigate({ to: "/devices/new" })}>
                <Plus className="h-4 w-4" />
                New device
              </Button>
            </Can>
          </div>
        }
      />

      {importing ? <DeviceImportDialog onClose={() => setImporting(false)} /> : null}

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        // The one thing people type constantly, without opening the panel first.
        quickSearch={{ field: "name", placeholder: "Search devices" }}
        // Site and Department are off by default rather than absent: eight columns
        // crowd the table, and the Columns menu is where somebody who wants them
        // goes. Everything the device carries is now offered there.
        initialColumnVisibility={{ locationName: false, departmentName: false }}
        emptyTitle="No devices yet"
        emptyDescription="Register the machines your reports will name."
        renderCard={(device) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Link
                to="/devices/$deviceId/edit"
                params={{ deviceId: device.id }}
                className="block truncate text-sm font-medium hover:underline"
              >
                {device.name}
              </Link>
              {device.assetTag ? (
                <span className="font-mono text-xs text-muted-foreground">{device.assetTag}</span>
              ) : null}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {device.assetName ?? "unplaced"}
            </span>
          </div>
        )}
      />
    </>
  );
}
