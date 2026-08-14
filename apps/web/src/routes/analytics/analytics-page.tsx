// Author: Brijesh Dave <https://github.com/brijeshdave>
// Analytics — how reliable a thing is, and what keeps going wrong.
//
// Two rules govern everything on this page:
//
//  1. **Nothing is computed here.** Every figure comes from the API. A browser
//     doing its own maths would drift from the server the moment a rule changed,
//     and the number people believe is whichever screen they opened last.
//  2. **A null figure renders as "—", never as a number.** MTBF is null when
//     nothing failed and MTTR when nothing was closed; both mean "unmeasured", and
//     showing 0 would rank the healthiest line in the plant as the worst.
import { type AssetReliability, PERMISSIONS, formatDate } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, AlertTriangle, Clock, Factory, Repeat } from "lucide-react";

import { AssetCascadePicker } from "@/components/asset-cascade-picker.js";
import { Select, Spinner } from "@/components/ui/form.js";
import { Badge, Card, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives.js";
import { fetchAssetReliability, fetchRecurring } from "@/services/analytics.js";
import { fetchAssets } from "@/services/assets.js";

/** Windows people actually ask for. The value is days back from now. */
const WINDOWS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last year", days: 365 },
];

const DAY_MS = 86_400_000;

/** The one place a null figure becomes text. Everything unmeasured reads "—". */
const show = (value: number | null, suffix = ""): string =>
  value === null ? "—" : `${value}${suffix}`;

function humanHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function humanMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function AnalyticsPage() {
  const [assetId, setAssetId] = useState<string>("");
  const [days, setDays] = useState<number>(90);

  const assets = useQuery({ queryKey: ["assets"], queryFn: fetchAssets });

  // The window is "the last N days from now". It is computed inside each query's
  // fetcher, NOT at render time: a `now` string in the query key changes on every
  // render (millisecond precision), and a key that changes every render refetches
  // every render — an endless request loop. Keying on `days` keeps the key stable
  // while still giving a fresh window on each real fetch.
  const windowFor = (span: number) => ({
    from: new Date(Date.now() - span * DAY_MS).toISOString(),
    to: new Date().toISOString(),
  });

  // Default to the first root asset, so the page shows something on arrival rather
  // than an empty picker the user has to discover.
  const roots = (assets.data ?? []).filter((a) => !a.parentId);
  const selectedId = assetId || roots[0]?.id || "";

  const reliability = useQuery({
    queryKey: ["analytics", "asset", selectedId, days],
    queryFn: () => fetchAssetReliability(selectedId, windowFor(days)),
    enabled: Boolean(selectedId),
  });

  const recurring = useQuery({
    queryKey: ["analytics", "recurring", selectedId, days],
    queryFn: () => fetchRecurring({ ...windowFor(days), assetId: selectedId || undefined }),
    enabled: Boolean(selectedId),
  });

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Reliability and recurring issues, rolled up from the asset tree."
      />

      {/* Filters: choose the asset a level at a time — the same cascading picker the
          journal editor uses — then the window. Drilling in narrows to that thing and
          everything under it; leaving a level unchosen keeps the level above. */}
      <Card className="mb-4 flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Asset</span>
          <AssetCascadePicker
            assets={assets.data ?? []}
            value={assetId ? [assetId] : []}
            onChange={(ids) => setAssetId(ids[0] ?? "")}
            multiple={false}
          />
        </div>
        <label className="flex w-full flex-col gap-1 text-sm sm:w-48">
          <span className="font-medium">Window</span>
          <Select
            aria-label="Window"
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {WINDOWS.map((w) => (
              <option key={w.days} value={w.days}>
                {w.label}
              </option>
            ))}
          </Select>
        </label>
      </Card>

      {assets.isLoading ? <Spinner /> : null}

      {!assets.isLoading && roots.length === 0 ? (
        <EmptyState
          icon={Factory}
          title="No assets yet"
          description="Reliability is measured against the asset tree. Add a line or a plant to get started."
        />
      ) : null}

      {reliability.isLoading ? <Spinner /> : null}

      {reliability.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Failures"
              value={reliability.data.total.failures}
              icon={AlertTriangle}
              hint={
                reliability.data.total.openCount > 0
                  ? `${reliability.data.total.openCount} still open`
                  : "all closed"
              }
            />
            <StatCard
              label="MTTR"
              value={humanMinutes(reliability.data.total.mttrMinutes)}
              icon={Clock}
              hint={
                reliability.data.total.mttrMinutes === null
                  ? "nothing closed yet"
                  : "mean time to repair"
              }
            />
            <StatCard
              label="MTBF"
              value={humanHours(reliability.data.total.mtbfHours)}
              icon={Repeat}
              // The null case gets an explanation rather than a dash alone: "not
              // measured" is a different thing from "measured as bad", and a
              // manager reading a dash deserves to know which.
              hint={
                reliability.data.total.mtbfHours === null
                  ? "nothing failed — not measured"
                  : "mean time between failures"
              }
            />
            <StatCard
              label="Availability"
              value={show(reliability.data.total.availabilityPct, "%")}
              icon={Activity}
              hint={`${Math.round(reliability.data.window.hours)}h window`}
            />
          </div>

          <ChildBreakdown children={reliability.data.children} />
        </>
      ) : null}

      <RecurringTable items={recurring.data?.items ?? []} loading={recurring.isLoading} />
    </>
  );
}

function ChildBreakdown({ children }: { children: AssetReliability[] }) {
  if (children.length === 0) return null;

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Breakdown</h2>
        <p className="text-xs text-muted-foreground">
          Each row covers that thing and everything under it. Worst first.
        </p>
      </div>
      {/* Wide content scrolls inside its own container — the page body never does. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Asset</th>
              <th className="px-4 py-2 text-right font-medium">Failures</th>
              <th className="px-4 py-2 text-right font-medium">Downtime</th>
              <th className="px-4 py-2 text-right font-medium">MTTR</th>
              <th className="px-4 py-2 text-right font-medium">MTBF</th>
              <th className="px-4 py-2 text-right font-medium">Availability</th>
            </tr>
          </thead>
          <tbody>
            {children.map((c) => (
              <tr key={c.assetId} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-medium">{c.assetName}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {c.failures}
                  {c.openCount > 0 ? (
                    <Badge tone="danger" className="ml-2">
                      {c.openCount} open
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {humanMinutes(c.totalDowntimeMinutes)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{humanMinutes(c.mttrMinutes)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{humanHours(c.mtbfHours)}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {show(c.availabilityPct, "%")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RecurringTable({
  items,
  loading,
}: {
  items: {
    targetLabel: string;
    categoryName: string | null;
    count: number;
    meanGapDays: number | null;
    lastSeenAt: string;
    latestReportId: string;
  }[];
  loading: boolean;
}) {
  return (
    <Card className="mt-4 overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Keeps happening</h2>
        <p className="text-xs text-muted-foreground">
          Issues grouped by what they are about and their category. Something that happened once is
          not here — one is not a pattern.
        </p>
      </div>
      {loading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className="p-4">
          <p className="text-sm text-muted-foreground">
            Nothing has recurred in this window. That is the good outcome.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Thing</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">Times</th>
                <th className="px-4 py-2 text-right font-medium">Every</th>
                <th className="px-4 py-2 text-right font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={`${r.targetLabel}-${r.categoryName}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2 font-medium">
                    <Link
                      to="/journal/$reportId"
                      params={{ reportId: r.latestReportId }}
                      className="hover:underline"
                    >
                      {r.targetLabel}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.categoryName ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <Badge tone={r.count >= 5 ? "danger" : "brand"}>{r.count}×</Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.meanGapDays === null ? "—" : `${r.meanGapDays}d`}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {formatDate(r.lastSeenAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export const ANALYTICS_PERMISSION = PERMISSIONS.ANALYTICS_VIEW;
