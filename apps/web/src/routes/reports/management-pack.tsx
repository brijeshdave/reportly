// Author: Brijesh Dave <https://github.com/brijeshdave>
// The management pack: a month of the plant on one page — headline numbers, then a
// section of charts per part of the operation — printable, and exportable as slides.
//
// Asked for from use: "i need a dashboard and reposrts that i can show to management
// for each month OR meeting in my presentation ppt… It should have many indicators
// and charts… All should be printable and exportable for my ppt", and then "make it
// like i can hide any section if i need".
//
// It is a **curated** pack rather than a tile builder. The value of a monthly review
// is that it looks the same every month, so the meeting argues about the numbers
// instead of about the layout — and a page somebody assembles by dragging is a page
// nobody can design for. What is configurable is what matters: the month, the part
// of the plant, and which sections appear at all.
//
// Nothing is computed here. Every figure, and every comparison with last month,
// arrives from the server — a card that worked out its own movement would be a
// second definition of a number the pack already states.
import {
  PACK_SECTIONS,
  type ManagementPack,
  type PackIndicator,
  type PackSection,
  type PackSectionData,
  type PackSeries,
} from "@reportly/shared";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  Building2,
  Download,
  FileDown,
  Image as ImageIcon,
  Printer,
  SlidersHorizontal,
} from "lucide-react";
import { useRef, useState } from "react";

import { ChartFrame } from "@/components/charts/chart-frame.js";
import { CompositionChart, RankedBarChart, TrendChart } from "@/components/charts/charts.js";
import { seriesColor, withOther } from "@/components/charts/palette.js";
import { Select, Spinner } from "@/components/ui/form.js";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { chartToPng, downloadDataUrl } from "@/lib/chart-image.js";
import type { DeckSection } from "@/lib/pack-deck.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchManagementPack } from "@/services/analytics.js";
import { fetchLocations } from "@/services/locations.js";
import { fetchDepartments } from "@/services/departments.js";

/** The sections, in the order they appear, with the words a person chooses by. */
const SECTION_LABELS: Record<PackSection, string> = {
  headline: "The month in numbers",
  reliability: "Reliability and downtime",
  activity: "What was filed",
  people: "People and points",
  compliance: "Routines and tasks",
  cartridges: "Cartridges",
};

/** Sections somebody can switch off. The headline numbers are the pack itself. */
const OPTIONAL_SECTIONS = PACK_SECTIONS.filter((s) => s !== "headline");

/** The month before this one, as the `<input type="month">` wants it. */
function lastCompleteMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

/** `{label,value}` rows in the shape ChartFrame's table view wants. */
function rowsOf(points: { label: string; value: number }[], column: string) {
  return points.map((p) => ({ label: p.label, values: [{ name: column, value: p.value }] }));
}

/**
 * The figure as it reads on a card.
 *
 * A null value is an em dash, never a zero: "median time to resolve: 0 h" would
 * claim the team closes everything instantly, when what happened is that nothing
 * was closed at all. The percent sign sits against its number, as a percent sign
 * does; every other unit takes a space.
 */
const formatValue = (indicator: PackIndicator): string => {
  if (indicator.value === null) return "—";
  const value = Number.isInteger(indicator.value)
    ? String(indicator.value)
    : indicator.value.toFixed(1);
  if (!indicator.unit) return value;
  return indicator.unit === "%" ? `${value}%` : `${value} ${indicator.unit}`;
};

/**
 * One headline number and how it moved.
 *
 * The movement is coloured by whether it is *good*, not by its direction: downtime
 * up is red and points up is green, and a dashboard that paints both the same way
 * teaches people to stop reading the colour.
 */
function IndicatorCard({ indicator, accent }: { indicator: PackIndicator; accent: string }) {
  const change = indicator.changePct;
  const better = change === null ? null : change > 0 === indicator.higherIsBetter;
  // Reported from use: "on web page also every tile looks very minimilistic no
  // proper weighte fonts, colors used". A card now carries a coloured rule, a
  // heavy figure at a size that reads across a desk, and its movement as a tinted
  // chip rather than a grey sentence.
  const chip =
    change === null || change === 0
      ? "bg-muted text-muted-foreground"
      : better
        ? "bg-success/10 text-success"
        : "bg-destructive/10 text-destructive";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: accent }}
      />
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {indicator.label}
      </p>
      <p className="mt-1.5 text-3xl font-bold leading-none tabular-nums text-foreground">
        {formatValue(indicator)}
      </p>
      <span
        className={`mt-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip}`}
      >
        {indicator.value === null
          ? "Not measured"
          : change === null
            ? indicator.previous === null
              ? "No comparison"
              : `Was ${indicator.previous}${indicator.unit === "%" ? "%" : indicator.unit ? ` ${indicator.unit}` : ""}`
            : `${change > 0 ? "▲" : change < 0 ? "▼" : "•"} ${Math.abs(change)}% vs previous`}
      </span>
      <p className="mt-2 text-xs leading-snug text-muted-foreground">{indicator.hint}</p>
    </div>
  );
}

/** A chart in its frame, with the button that turns it into a picture for a deck. */
function PackChart({
  series,
  window: windowLabel,
  registerRef,
  colorIndex,
}: {
  series: PackSeries;
  window: string;
  registerRef: (key: string, element: HTMLDivElement | null) => void;
  /** Reported from use: "thos echarts are having same color and looks same for all
   *  charts". One hue per chart, so a reader can tell two panels apart at a glance
   *  and a chart keeps its colour between the screen and the slide. */
  colorIndex: number;
}) {
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const host = document.getElementById(`pack-chart-${series.key}`);
      if (!host) return;
      const image = await chartToPng(host);
      if (image) downloadDataUrl(image.dataUrl, `${series.key}.png`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id={`pack-chart-${series.key}`} ref={(element) => registerRef(series.key, element)}>
      <ChartFrame
        title={series.title}
        description={series.description}
        window={windowLabel}
        rows={rowsOf(series.points, series.unit)}
        columns={["", series.unit]}
        action={
          // In the frame's control row, beside the Table toggle: floated over the
          // chart it sat on top of that button. Never printed — a printout does not
          // need a download button on every figure.
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="no-print flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden />
            {busy ? "Saving…" : "PNG"}
          </button>
        }
      >
        {series.key === "entriesByStatus" ? (
          <CompositionChart data={withOther(series.points)} />
        ) : (
          <RankedBarChart
            data={withOther(series.points)}
            unit={series.unit}
            colorIndex={colorIndex}
          />
        )}
      </ChartFrame>
    </div>
  );
}

export function ManagementPackPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [month, setMonth] = useState(lastCompleteMonth());
  const [locationId, setLocationId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [hidden, setHidden] = useState<PackSection[]>([]);
  // Which indicators go on the deck's first slide. Asked for as "i want to control
  // what indicators to be shown in ppt" — the page keeps showing every number,
  // because reading them all is what the page is for. Null means "not chosen yet",
  // which is every indicator; an empty array is a deliberate none.
  const [deckKeys, setDeckKeys] = useState<string[] | null>(null);
  const [pickingIndicators, setPickingIndicators] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Every chart on the page, by key, so the deck can find the drawn SVG rather than
  // rendering the same data a second time with a different engine.
  const charts = useRef(new Map<string, HTMLDivElement>());
  const registerRef = (key: string, element: HTMLDivElement | null) => {
    if (element) charts.current.set(key, element);
    else charts.current.delete(key);
  };

  const wanted = PACK_SECTIONS.filter((section) => !hidden.includes(section));
  const sites = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });

  const { data, isPending, isError } = useQuery({
    queryKey: ["insights", "pack", month, locationId, departmentId, wanted.join(",")],
    queryFn: () =>
      fetchManagementPack({
        month,
        locationId: locationId || undefined,
        departmentId: departmentId || undefined,
        sections: wanted,
      }),
    enabled: Boolean(session.companyId),
  });

  if (!session.companyId) {
    return (
      <>
        <PageHeader title="Management pack" />
        <EmptyState
          icon={Building2}
          title="Choose a company first"
          description="A pack covers one company's month, so there is nothing to build until one is chosen in the top-bar switcher."
        />
      </>
    );
  }

  const toggle = (section: PackSection) =>
    setHidden((current) =>
      current.includes(section) ? current.filter((s) => s !== section) : [...current, section],
    );

  const exportDeck = async (pack: ManagementPack) => {
    setExporting(true);
    try {
      const sections: DeckSection[] = [];
      for (const section of pack.sections) {
        const built: DeckSection = { title: section.title, charts: [] };
        if (section.trend) {
          const host = charts.current.get(`trend-${section.section}`);
          const image = host ? await chartToPng(host) : null;
          if (image) {
            built.charts.push({
              title: section.trendTitle ?? section.title,
              // The legend does not survive the export: recharts draws it as HTML
              // beside the chart, not inside the SVG, so a two-line chart would
              // reach a slide with nothing saying which line is which.
              description: "Issues in blue, work logged in orange — per day",
              image,
            });
          }
        }
        for (const series of section.series) {
          const host = charts.current.get(series.key);
          const image = host ? await chartToPng(host) : null;
          if (image) {
            built.charts.push({ title: series.title, description: series.description, image });
          }
        }
        if (section.table) built.table = section.table;
        sections.push(built);
      }
      // Loaded only now: the deck builder is a megabyte of library that a person
      // who never exports should not be made to download.
      const { downloadPackDeck } = await import("@/lib/pack-deck.js");
      const name = `${pack.companyName || "Reportly"} ${pack.periodLabel}`.replace(/[^\w -]/g, "");
      await downloadPackDeck(pack, sections, `${name}.pptx`, {
        indicatorKeys: deckKeys ?? undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  const windowLabel = data ? data.periodLabel : "";

  return (
    <div className="pack-page">
      <PageHeader
        title="Management pack"
        description="A month of the plant in one page: the headline numbers against the month before, then the charts behind them. Print it, or export it as slides."
        actions={
          data ? (
            <div className="no-print flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
              <Button size="sm" onClick={() => void exportDeck(data)} disabled={exporting}>
                {exporting ? <Spinner /> : <FileDown className="h-4 w-4" />}
                {exporting ? "Building…" : "PowerPoint"}
              </Button>
            </div>
          ) : null
        }
      />

      {/* The controls. Never printed and never in the deck: what somebody chose is
          said by the period line on the page itself. */}
      <Card className="no-print mt-4 flex flex-wrap items-end gap-4 p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Site</span>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Every site</option>
            {(sites.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Department</span>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Every department</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Sections</span>
          <div className="flex flex-wrap gap-3">
            {OPTIONAL_SECTIONS.map((section) => (
              <label key={section} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={!hidden.includes(section)}
                  onChange={() => toggle(section)}
                />
                {SECTION_LABELS[section]}
              </label>
            ))}
          </div>
        </div>
        {/* Which numbers reach the deck. The page keeps them all — this only
            decides what slide 1 carries. */}
        {data ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Indicators on the deck</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPickingIndicators((open) => !open)}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {deckKeys === null
                  ? `All ${data.indicators.length}`
                  : `${deckKeys.length} of ${data.indicators.length}`}
              </Button>
              {deckKeys !== null ? (
                <Button size="sm" variant="ghost" onClick={() => setDeckKeys(null)}>
                  Reset
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>

      {data && pickingIndicators ? (
        <Card className="no-print mt-3 p-4">
          <p className="mb-2 text-sm font-medium">
            Tick the numbers that go on the deck&apos;s first slide
          </p>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.indicators.map((indicator) => {
              const on = deckKeys === null || deckKeys.includes(indicator.key);
              return (
                <label key={indicator.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setDeckKeys((current) => {
                        // The first tick turns "all" into a real list, so unticking
                        // one indicator does not silently mean "only that one".
                        const base = current ?? data.indicators.map((i) => i.key);
                        return on
                          ? base.filter((key) => key !== indicator.key)
                          : [...base, indicator.key];
                      })
                    }
                  />
                  {indicator.label}
                </label>
              );
            })}
          </div>
        </Card>
      ) : null}

      {isPending ? (
        <div className="pt-8">
          <Spinner />
        </div>
      ) : isError || !data ? (
        <EmptyState
          icon={Download}
          title="The pack could not be built"
          description="Try a different month, or narrow it to one site."
        />
      ) : (
        <div className="pack-sheet flex flex-col gap-6 pt-4">
          {/* The printed and presented header: what this is about, stated on the
              page, because a printout has no browser chrome to explain itself. */}
          <div className="hidden print:block">
            <h1 className="text-xl font-semibold">{data.companyName}</h1>
            <p className="text-sm text-muted-foreground">
              Operations review — {data.periodLabel}, compared with the previous period
            </p>
          </div>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {SECTION_LABELS.headline} · {data.periodLabel}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.indicators.map((indicator, index) => (
                <IndicatorCard
                  key={indicator.key}
                  indicator={indicator}
                  accent={seriesColor(index % 6)}
                />
              ))}
            </div>
          </section>

          {/* Location-wise, asked for directly: "i need location wise data to be
              shown in presentation". Above the sections, because "which plant" is
              the first question a management meeting asks. */}
          {data.sites.length > 0 ? (
            <section className="break-inside-avoid">
              <h2 className="mb-3 text-sm font-semibold text-foreground">By site</h2>
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Site</th>
                      <th className="px-4 py-2 font-medium">Issues</th>
                      <th className="px-4 py-2 font-medium">Open</th>
                      <th className="px-4 py-2 font-medium">Downtime (h)</th>
                      {/* A column per service kind this company actually records —
                          "include issues, cartridge refill, repair, tasks and
                          routines" — named as the installation names them. */}
                      {data.serviceKinds.map((kind) => (
                        <th key={kind} className="px-4 py-2 font-medium">
                          {kind}
                        </th>
                      ))}
                      <th className="px-4 py-2 font-medium">Tasks</th>
                      <th className="px-4 py-2 font-medium">Routines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sites.map((site) => (
                      <tr key={site.site} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap px-4 py-2 font-medium">{site.site}</td>
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums">{site.issues}</td>
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums">{site.open}</td>
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                          {site.downtimeHours.toFixed(1)}
                        </td>
                        {data.serviceKinds.map((kind) => (
                          <td key={kind} className="whitespace-nowrap px-4 py-2 tabular-nums">
                            {site.services[kind] ?? 0}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums">{site.tasks}</td>
                        <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                          {site.routines}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {data.sections.map((section: PackSectionData) => (
            <section key={section.section} className="break-inside-avoid">
              <h2 className="mb-3 text-sm font-semibold text-foreground">{section.title}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {section.trend ? (
                  <div
                    id={`pack-chart-trend-${section.section}`}
                    ref={(element) => registerRef(`trend-${section.section}`, element)}
                    className="lg:col-span-2"
                  >
                    <ChartFrame
                      title={section.trendTitle ?? "Through the period"}
                      window={windowLabel}
                      rows={section.trend.map((p) => ({
                        label: p.label,
                        values: [
                          { name: "Issues", value: p.issues },
                          { name: "Work", value: p.work },
                        ],
                      }))}
                      columns={["Date", "Issues", "Work"]}
                    >
                      <TrendChart data={section.trend} />
                    </ChartFrame>
                  </div>
                ) : null}

                {section.series.map((series, index) => (
                  <PackChart
                    key={series.key}
                    series={series}
                    window={windowLabel}
                    registerRef={registerRef}
                    colorIndex={index}
                  />
                ))}
              </div>

              {section.table && section.table.rows.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
                  <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
                    {section.table.title}
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        {section.table.columns.map((column) => (
                          <th key={column} className="px-4 py-2 font-medium">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map((row) => (
                        <tr key={row.join("|")} className="border-b border-border last:border-0">
                          {row.map((cell, index) => (
                            <td key={index} className="whitespace-nowrap px-4 py-2">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}

      {/*
        Print rules live with the page they print, as the report workspace's do —
        and they fix the same two faults reported here: "when i click print, it
        opens a preview but it has only visible page not full data. also all that
        shows black and white."

        The clipping is the app shell: it is `h-screen overflow-hidden` with a
        scrolling `main`, so the printer is handed one screenful. Lifting the sheet
        out with `position: absolute` and forcing every ancestor's overflow visible
        is what the journal's printable report already does.

        The greyscale is the browser's own economy: it drops backgrounds unless a
        page insists. `print-color-adjust: exact` is that insistence — a dashboard
        whose red and green carry the meaning cannot be printed without them.
      */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          html, body { height: auto !important; overflow: visible !important; }
          body * { visibility: hidden !important; }
          .pack-sheet, .pack-sheet * { visibility: visible !important; }
          .pack-sheet {
            position: absolute;
            inset: 0;
            margin: 0;
            width: 100%;
            overflow: visible !important;
          }
          /* Every scroll container between the sheet and the page, released. */
          .pack-page, .pack-page * { overflow: visible !important; max-height: none !important; }
          .no-print { display: none !important; }
          /* Colour is the meaning here, not decoration. */
          .pack-sheet, .pack-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .pack-sheet section { break-inside: avoid; }
          .pack-sheet figure, .pack-sheet table { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
