// Author: Brijesh Dave <https://github.com/brijeshdave>
// Audit viewer. The trail is immutable — the API exposes no write or delete path —
// so this is read and export only. A row opens into the same detail drawer the log
// viewer uses, so the two read alike and a request id links across them.
import { PERMISSIONS, type AuditEvent, type DeviceInfo, formatDateTime } from "@reportly/shared";
import { Link } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { DeviceSummary, DeviceDetails } from "@/components/device-info.js";
import { DetailDrawer, DetailJson, DetailRow, DetailSection } from "@/components/detail-drawer.js";
import { Badge, PageHeader } from "@/components/ui/primitives.js";
import { UserRef } from "@/components/user-ref.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { deviceFromDetails } from "@/lib/device-info.js";

const filterDefs: FilterDef[] = [
  { field: "createdAt", label: "Date range", kind: "daterange" },
  { field: "action", label: "Action", kind: "text" },
  { field: "actorId", label: "Actor ID", kind: "text", op: "eq" },
  { field: "requestId", label: "Request ID", kind: "text", op: "eq" },
];

/** A column that reads one field off the event's captured device. Text, muted. */
function deviceColumn(
  id: string,
  header: string,
  read: (device: DeviceInfo) => unknown,
): TableColumn<AuditEvent> {
  return {
    id,
    header,
    enableSorting: false,
    cell: ({ row }) => {
      const device = deviceFromDetails(row.original.details);
      const value = device ? read(device) : null;
      return value ? (
        <span className="whitespace-nowrap text-sm text-muted-foreground">{String(value)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  };
}

const columns: TableColumn<AuditEvent>[] = [
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "When",
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
  {
    id: "action",
    accessorKey: "action",
    header: "Action",
    enableSorting: false,
    cell: ({ row }) => <Badge>{row.original.action}</Badge>,
  },
  {
    id: "actor",
    header: "Actor",
    enableSorting: false,
    cell: ({ row }) => (
      <UserRef
        userId={row.original.actorId}
        name={row.original.actorName}
        email={row.original.actorEmail}
      />
    ),
  },
  {
    id: "actorId",
    accessorKey: "actorId",
    header: "Actor ID",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.actorId ? (
        <code className="text-xs text-muted-foreground">{row.original.actorId}</code>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "ip",
    accessorKey: "ip",
    header: "IP",
    enableSorting: false,
    cell: ({ row }) => row.original.ip ?? "—",
  },
  {
    id: "device",
    header: "Device",
    enableSorting: false,
    cell: ({ row }) => <DeviceSummary device={deviceFromDetails(row.original.details)} />,
  },
  // Every captured device field is available as its own column, hidden until turned
  // on from the Columns menu (see initialColumnVisibility) so the table stays calm.
  deviceColumn("browser", "Browser", (d) => d.browser),
  deviceColumn("os", "OS", (d) => d.os),
  deviceColumn("deviceType", "Type", (d) => d.deviceType),
  deviceColumn("timezone", "Timezone", (d) => d.timezone),
  deviceColumn("location", "Location", (d) =>
    d.geo ? [d.geo.city, d.geo.country].filter(Boolean).join(", ") : null,
  ),
  deviceColumn("languages", "Languages", (d) => d.languages?.join(", ")),
  deviceColumn("screen", "Screen", (d) => d.screen),
  deviceColumn("platform", "Platform", (d) => d.platform),
  deviceColumn("gpu", "GPU", (d) => d.gpu),
  deviceColumn("fingerprint", "Fingerprint", (d) => d.fingerprint),
  deviceColumn("forwardedFor", "Proxy chain", (d) => d.forwardedFor),
];

// Everyday use is who-did-what-when; IP and the per-field device columns are for
// security analysis, so they start hidden and turn on from the Columns menu.
const initialColumnVisibility = {
  actorId: false,
  ip: false,
  browser: false,
  os: false,
  deviceType: false,
  timezone: false,
  location: false,
  languages: false,
  screen: false,
  platform: false,
  gpu: false,
  fingerprint: false,
  forwardedFor: false,
};

export function AuditPage() {
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const list = useListResource<AuditEvent>({
    resource: "audit-events",
    path: "/audit-events",
    exportPath: "/audit-events/export",
    initial: { sortBy: "createdAt", sortDir: "desc" },
  });

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every mutation and security event, with who did it, from where, and the request that carried it. Append-only."
      />

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        initialColumnVisibility={initialColumnVisibility}
        onRowClick={setSelected}
        emptyTitle="No audit events"
        emptyDescription="Actions that change data will appear here."
        renderCard={(event) => (
          <button
            type="button"
            onClick={() => setSelected(event)}
            className="flex w-full flex-col items-start gap-1 text-left"
          >
            <Badge>{event.action}</Badge>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(event.createdAt)} · {event.actorName ?? event.actorId ?? "system"}
            </span>
          </button>
        )}
      />

      {selected ? <AuditDetail event={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function AuditDetail({ event, onClose }: { event: AuditEvent; onClose: () => void }) {
  const device = deviceFromDetails(event.details);
  const canViewLogs = usePermission(PERMISSIONS.LOGS_VIEW);

  return (
    <DetailDrawer
      label={`Audit event ${event.action}`}
      onClose={onClose}
      header={
        <div>
          <Badge>{event.action}</Badge>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
        </div>
      }
    >
      <DetailSection title="Who & where">
        <DetailRow label="Actor">
          <UserRef userId={event.actorId} name={event.actorName} email={event.actorEmail} />
        </DetailRow>
        {event.actorId ? (
          <DetailRow label="Actor ID">
            <code className="text-xs">{event.actorId}</code>
          </DetailRow>
        ) : null}
        <DetailRow label="IP">{event.ip ?? "unknown"}</DetailRow>
        <DetailRow label="Request ID">
          {event.requestId ? (
            <span className="flex flex-wrap items-center gap-2">
              <code className="text-xs">{event.requestId}</code>
              {/* The same id tags every log line for this request, so jump straight
                  to them — API, background jobs and any browser error. */}
              {canViewLogs ? (
                <Link
                  to="/logs"
                  search={{ tab: "search", requestId: event.requestId }}
                  onClick={onClose}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <ScrollText className="h-3.5 w-3.5" />
                  View logs
                </Link>
              ) : null}
            </span>
          ) : (
            "none"
          )}
        </DetailRow>
      </DetailSection>

      {device ? (
        <DetailSection title="Device">
          <DeviceDetails device={device} />
        </DetailSection>
      ) : null}

      {event.details ? (
        <DetailSection title="Details">
          <DetailJson value={event.details} />
        </DetailSection>
      ) : null}

      {event.before ? (
        <DetailSection title="Before">
          <DetailJson value={event.before} />
        </DetailSection>
      ) : null}

      {event.after ? (
        <DetailSection title="After">
          <DetailJson value={event.after} />
        </DetailSection>
      ) : null}
    </DetailDrawer>
  );
}
