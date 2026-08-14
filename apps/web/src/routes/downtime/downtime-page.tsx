// Author: Brijesh Dave <https://github.com/brijeshdave>
// Downtime across the company: what is still down right now, and what it has all
// cost. Two tabs because they answer two different questions — "what do I chase
// today?" and "what should we fix for good?".
import { PERMISSIONS, formatDateTime } from "@reportly/shared";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";

import { usePermission } from "@/components/can.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import { sessionQuery } from "@/lib/queries.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { formatMinutes } from "@/routes/journal/downtime-panel.js";
import { fetchDowntimeTotals, fetchPendingDowntime } from "@/services/downtime.js";

const TABS = [
  { id: "pending", label: "Still down" },
  { id: "totals", label: "Totals" },
];

export function DowntimePage({ tab }: { tab: string }) {
  const navigate = useNavigate({ from: "/downtime" });
  const { data: session } = useSuspenseQuery(sessionQuery);
  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "pending";

  const header = (
    <PageHeader
      title="Downtime"
      description="How long equipment has been out of service. This is not the time people spent working — that lives on the report itself."
    />
  );

  // Downtime belongs to a company; without one the request can only 400.
  if (!session.companyId) {
    return (
      <>
        {header}
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher to see its downtime."
        />
      </>
    );
  }

  return (
    <>
      {header}
      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void navigate({ search: { tab: id }, replace: true })}
      />
      <div className="pt-6">
        <TabPanel id="pending" active={activeTab}>
          <PendingTab />
        </TabPanel>
        <TabPanel id="totals" active={activeTab}>
          <TotalsTab />
        </TabPanel>
      </div>
    </>
  );
}

/** How long ago something went down, in words. */
function since(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return formatMinutes(minutes);
}

function PendingTab() {
  const canWrite = usePermission(PERMISSIONS.DOWNTIME_WRITE);
  const pending = useQuery({ queryKey: ["downtime", "pending"], queryFn: fetchPendingDowntime });

  if (pending.isLoading) return <Spinner />;
  if (pending.error) return <ErrorAlert error={pending.error} />;

  const list = pending.data ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Outages with no end time yet — yours and your team&rsquo;s. They keep counting until
        somebody closes them, which is the point: an open breakdown should be uncomfortable to look
        at.
      </p>

      {list.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Nothing is down. {canWrite ? "Record downtime from the report it belongs to." : null}
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {list.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{entry.targetLabel}</span>
                  <Badge tone="warning">down {since(entry.startedAt)}</Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Since {formatDateTime(entry.startedAt)} · logged by {entry.createdByName}
                  {entry.reason ? ` · ${entry.reason}` : ""}
                </p>
              </div>
              {/* Closing it happens on the report, where the outage's context is. */}
              <Link
                to="/journal/$reportId"
                params={{ reportId: entry.reportId }}
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                Open report
              </Link>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function TotalsTab() {
  const totals = useQuery({ queryKey: ["downtime", "totals"], queryFn: fetchDowntimeTotals });

  if (totals.isLoading) return <Spinner />;
  if (totals.error) return <ErrorAlert error={totals.error} />;

  const list = totals.data ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Total time down per thing, worst first. An outage that is still open counts up to now, so a
        running breakdown shows here rather than reading as zero.
      </p>

      {list.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No downtime has been recorded yet.
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          <div className="grid grid-cols-[1fr_6rem_5rem] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>Thing</span>
            <span className="text-right">Total down</span>
            <span className="text-right">Outages</span>
          </div>
          {list.map((total) => (
            <div
              key={`${total.targetKind}:${total.targetId}`}
              className="grid grid-cols-[1fr_6rem_5rem] items-center gap-3 px-4 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{total.targetLabel}</span>
                <span className="text-xs text-muted-foreground">{total.targetKind}</span>
                {total.openCount > 0 ? <Badge tone="warning">down now</Badge> : null}
              </div>
              <span className="text-right tabular-nums">{formatMinutes(total.totalMinutes)}</span>
              <span className="text-right tabular-nums text-muted-foreground">
                {total.entryCount}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
