// Author: Brijesh Dave <https://github.com/brijeshdave>
// What Reportly sent out, and whether it arrived.
//
// Before this, an email left through a queue to nodemailer and nothing survived
// the job: "did their password reset go out?" could only be answered by asking
// them, and a provider's refusal went to a log nobody was reading. An
// installation once spent a week believing it was sending mail while every
// message was refused.
//
// Read-only, deliberately. There is no delete, not even for one row — a log
// somebody can tidy answers nothing.
import {
  MESSAGE_CHANNELS,
  MESSAGE_KINDS,
  MESSAGE_STATUSES,
  type OutboundMessage,
  formatDateTime,
} from "@reportly/shared";
import { useState } from "react";

import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { DetailDrawer, DetailRow, DetailSection } from "@/components/detail-drawer.js";
import { Badge, PageHeader } from "@/components/ui/primitives.js";
import { UserRef } from "@/components/user-ref.js";
import { useListResource } from "@/hooks/use-list-resource.js";

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: titleCase(value.replace(/-/g, " ")) }));

const filterDefs: FilterDef[] = [
  { field: "queuedAt", label: "Date range", kind: "daterange" },
  { field: "channel", label: "Channel", kind: "select", options: options(MESSAGE_CHANNELS) },
  { field: "kind", label: "Kind", kind: "select", options: options(MESSAGE_KINDS) },
  { field: "status", label: "Status", kind: "select", options: options(MESSAGE_STATUSES) },
  { field: "eventType", label: "Notification type", kind: "text" },
  { field: "subject", label: "Subject", kind: "text" },
];

const statusTone = { sent: "success", failed: "danger", queued: "neutral" } as const;

const columns: TableColumn<OutboundMessage>[] = [
  {
    id: "queuedAt",
    accessorKey: "queuedAt",
    header: "When",
    cell: ({ row }) => formatDateTime(row.original.queuedAt),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge tone={statusTone[row.original.status]}>{row.original.status}</Badge>,
  },
  { id: "channel", accessorKey: "channel", header: "Channel" },
  {
    id: "kind",
    accessorKey: "kind",
    header: "Kind",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        {titleCase(row.original.kind.replace(/-/g, " "))}
        {row.original.eventType ? (
          <span className="ml-1 text-xs text-muted-foreground">{row.original.eventType}</span>
        ) : null}
      </span>
    ),
  },
  {
    id: "toUserId",
    header: "To",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.toUserId ? (
        <UserRef userId={row.original.toUserId} name={row.original.toUserName} />
      ) : (
        // Somebody typed an address at a login screen: there is no account to link.
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "destination",
    accessorKey: "destination",
    header: "Destination",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">{row.original.destination}</span>
    ),
  },
  { id: "subject", accessorKey: "subject", header: "Subject" },
];

export function MessagesPage() {
  const [selected, setSelected] = useState<OutboundMessage | null>(null);
  const list = useListResource<OutboundMessage>({
    resource: "messages",
    path: "/messages",
    initial: { sortBy: "queuedAt", sortDir: "desc" },
  });

  return (
    <>
      <PageHeader
        title="Messages"
        description="Every email, SMS, WhatsApp, Telegram and Discord message Reportly sent, and what the provider said back. Addresses are stored part-hidden, and message bodies are never stored at all."
      />

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        quickSearch={{ field: "subject", placeholder: "Search subjects" }}
        quickToggle={{
          field: "status",
          label: "Delivery",
          options: [
            { value: "sent", label: "Sent" },
            { value: "failed", label: "Failed" },
            { value: "queued", label: "Queued" },
          ],
        }}
        onRowClick={setSelected}
        emptyTitle="Nothing has been sent yet"
        emptyDescription="Emails, notifications and verification codes will appear here as they go out."
      />

      {selected ? (
        <DetailDrawer
          label={`Message ${selected.kind}`}
          onClose={() => setSelected(null)}
          header={
            <div>
              <Badge tone={statusTone[selected.status]}>{selected.status}</Badge>
              <p className="mt-1 text-sm font-medium">{selected.subject ?? "No subject"}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(selected.queuedAt)}</p>
            </div>
          }
        >
          <DetailSection title="Delivery">
            <DetailRow label="Channel">{selected.channel}</DetailRow>
            <DetailRow label="Kind">{titleCase(selected.kind.replace(/-/g, " "))}</DetailRow>
            {selected.eventType ? (
              <DetailRow label="Notification type">
                <code className="text-xs">{selected.eventType}</code>
              </DetailRow>
            ) : null}
            <DetailRow label="Attempts">{selected.attempts}</DetailRow>
            <DetailRow label="Sent">
              {selected.sentAt ? formatDateTime(selected.sentAt) : "not yet"}
            </DetailRow>
          </DetailSection>

          <DetailSection title="Recipient">
            <DetailRow label="Person">
              {selected.toUserId ? (
                <UserRef userId={selected.toUserId} name={selected.toUserName} />
              ) : (
                // An address typed at a login screen belongs to no account here.
                "Not an account"
              )}
            </DetailRow>
            <DetailRow label="Destination">
              <code className="text-xs">{selected.destination}</code>
            </DetailRow>
          </DetailSection>

          {selected.error ? (
            // The provider's own words, whole. "API key not authorized for this
            // domain" is the entire diagnosis; a tidied summary would not be.
            <DetailSection title="What the provider said">
              <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                {selected.error}
              </p>
            </DetailSection>
          ) : null}
        </DetailDrawer>
      ) : null}
    </>
  );
}
