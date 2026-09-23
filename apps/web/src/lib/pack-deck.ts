// Author: Brijesh Dave <https://github.com/brijeshdave>
// The management pack as a PowerPoint file — three dense slides, not seventeen.
//
// Asked for from use: "i need a dashboard and reposrts that i can show to management
// for each month OR meeting in my presentation ppt", and then, after reading the
// first one: "i dont need thease many slides. i need 2-3 slides that can acomodate
// all infor that should be shown."
//
// So the shape is fixed at three:
//
//   1. **The month at a glance** — the title bar, every headline number, and the
//      by-site table. One slide somebody can hold up and answer questions from.
//   2. **Where the work is** — four charts in a grid.
//   3. **Who and what** — four more charts, and what keeps coming back.
//
// A real .pptx rather than a PDF or a folder of images, because what happens to this
// deck next is *editing*: somebody drops a slide, retitles another, pastes one into
// a bigger deck. A picture of a report cannot be edited, and a person who has to
// rebuild the deck by hand every month stops using the feature by March.
//
// The library is imported dynamically, at the moment somebody exports. It is close
// to a megabyte, and it has no business being in the bundle of a plant operator who
// only ever files entries.
import type PptxGenJSType from "pptxgenjs";

import type { ManagementPack, PackIndicator } from "@reportly/shared";

import type { ChartImage } from "@/lib/chart-image.js";

/** A chart, already rendered, with the words that belong beside it. */
export interface DeckChart {
  title: string;
  description: string;
  image: ChartImage;
}

/** One section's worth, as the page collected it. */
export interface DeckSection {
  title: string;
  charts: DeckChart[];
  table?: { title: string; columns: string[]; rows: string[][] };
}

const INK = "1F2933";
const MUTED = "6B7280";
const GOOD = "047857";
const BAD = "B91C1C";
const BAND = "13314B";
const LINE = "E5E7EB";

/**
 * The slide, in inches.
 *
 * `LAYOUT_WIDE` and not `LAYOUT_16x9`: both are 16:9, but the library's `16x9`
 * preset is a 10 × 5.625 inch slide while `WIDE` is 13.33 × 7.5, and every
 * coordinate below is written against the larger one. Pairing these numbers with
 * the smaller preset puts half the cards off the right-hand edge — which is the
 * sort of fault that only shows up in the room.
 */
const SLIDE_W = 13.33;
const SLIDE_H = 7.5;

/** The figure as it reads on a slide: "12.5 h", "83%", "14" — or a dash.
 *
 * Unmeasured prints as a dash rather than a zero. A slide is the one place a
 * confident zero cannot be questioned: nobody in the room can hover it. */
function figure(indicator: PackIndicator): string {
  if (indicator.value === null) return "—";
  const value = Number.isInteger(indicator.value)
    ? String(indicator.value)
    : indicator.value.toFixed(1);
  if (!indicator.unit) return value;
  return indicator.unit === "%" ? `${value}%` : `${value} ${indicator.unit}`;
}

/** "▲ 12% vs previous", or the plain previous figure when a percentage would lie. */
function movement(indicator: PackIndicator): { text: string; color: string } {
  if (indicator.value === null) return { text: "not measured", color: MUTED };
  if (indicator.changePct === null) {
    return {
      text: indicator.previous === null ? "" : `was ${indicator.previous}`,
      color: MUTED,
    };
  }
  const up = indicator.changePct > 0;
  const better = up === indicator.higherIsBetter;
  const arrow = up ? "▲" : indicator.changePct < 0 ? "▼" : "•";
  return {
    text: `${arrow} ${Math.abs(indicator.changePct)}% vs previous`,
    // Colour says whether it is good news, not which way the arrow points. More
    // downtime is an increase and bad news, and a dashboard that paints both green
    // is read exactly once.
    color: indicator.changePct === 0 ? MUTED : better ? GOOD : BAD,
  };
}

/** The one slide type these helpers draw on, named rather than structurally typed. */
type Slide = PptxGenJSType.Slide;

/** The dark banner every slide wears, so the deck reads as one document. */
function banner(
  slide: Slide,
  shapes: { rect: PptxGenJSType.ShapeType },
  title: string,
  right: string,
): void {
  slide.addShape(shapes.rect, { x: 0, y: 0, w: SLIDE_W, h: 0.85, fill: { color: BAND } });
  slide.addText(title, {
    x: 0.4,
    y: 0.12,
    w: 8.5,
    h: 0.6,
    fontSize: 22,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
  });
  slide.addText(right, {
    x: SLIDE_W - 4.6,
    y: 0.12,
    w: 4.2,
    h: 0.6,
    fontSize: 13,
    color: "C7D6E4",
    align: "right",
    valign: "middle",
  });
}

/**
 * Lay charts out in a grid, each fitted inside its cell.
 *
 * Fitted rather than stretched: a bar chart squashed into an arbitrary box is a
 * chart that misreports its own proportions, which on a slide nobody can interrogate
 * is just a wrong picture.
 */
function addChartGrid(
  slide: Slide,
  charts: DeckChart[],
  area: { x: number; y: number; w: number; h: number },
  columns: number,
): void {
  if (charts.length === 0) return;
  const rows = Math.ceil(charts.length / columns);
  const cellW = area.w / columns;
  const cellH = area.h / rows;

  charts.forEach((chart, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = area.x + column * cellW;
    const y = area.y + row * cellH;

    slide.addText(chart.title, {
      x: x + 0.1,
      y,
      w: cellW - 0.2,
      h: 0.3,
      fontSize: 13,
      bold: true,
      color: INK,
    });

    const imageArea = { w: cellW - 0.3, h: cellH - 0.5 };
    const ratio = Math.min(imageArea.w / chart.image.width, imageArea.h / chart.image.height);
    const w = chart.image.width * ratio;
    const h = chart.image.height * ratio;
    slide.addImage({
      data: chart.image.dataUrl,
      x: x + 0.15 + (imageArea.w - w) / 2,
      y: y + 0.35 + (imageArea.h - h) / 2,
      w,
      h,
    });
  });
}

/** A table with the pack's own styling, used for sites and for what recurs. */
function addTable(
  slide: Slide,
  title: string,
  columns: string[],
  rows: string[][],
  at: { x: number; y: number; w: number; h?: number },
  rowLimit: number,
): void {
  if (rows.length === 0) return;
  slide.addText(title, {
    x: at.x,
    y: at.y,
    w: at.w,
    h: 0.3,
    fontSize: 13,
    bold: true,
    color: INK,
  });
  slide.addTable(
    [
      columns.map((text) => ({
        text,
        options: { bold: true, color: INK, fill: { color: "F3F4F6" }, fontSize: 11 },
      })),
      ...rows
        .slice(0, rowLimit)
        .map((row) => row.map((text) => ({ text, options: { color: INK, fontSize: 11 } }))),
    ],
    {
      x: at.x,
      y: at.y + 0.35,
      w: at.w,
      fontSize: 11,
      border: { type: "solid", color: LINE, pt: 1 },
    },
  );
}

/**
 * Build and download the deck.
 *
 * `sections` arrives in the order the page drew them; the slides pull what they need
 * by name rather than by position, so a section switched off leaves a gap in the
 * grid instead of shuffling an unrelated chart into the wrong slide.
 */
export async function downloadPackDeck(
  pack: ManagementPack,
  sections: DeckSection[],
  filename: string,
): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.title = `${pack.companyName} — ${pack.periodLabel}`;
  const shapes = { rect: deck.ShapeType.rect };

  const charts = sections.flatMap((section) => section.charts);
  const chartNamed = (title: string) => charts.find((chart) => chart.title === title);
  const period = `${pack.periodLabel} · vs previous period`;

  // ---------------------------------------------------------------- slide 1
  // Everything somebody is asked about in the first two minutes: the numbers, and
  // which site they came from.
  const one = deck.addSlide();
  banner(one, shapes, `${pack.companyName || "Operations"} — ${pack.periodLabel}`, period);

  const perRow = 5;
  pack.indicators.forEach((indicator, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    const x = 0.35 + column * 2.56;
    const y = 1.05 + row * 1.15;
    one.addShape(shapes.rect, {
      x,
      y,
      w: 2.4,
      h: 1.0,
      fill: { color: "FFFFFF" },
      line: { color: LINE, width: 1 },
    });
    one.addText(indicator.label.toUpperCase(), {
      x: x + 0.12,
      y: y + 0.06,
      w: 2.16,
      h: 0.25,
      fontSize: 9,
      color: MUTED,
    });
    one.addText(figure(indicator), {
      x: x + 0.12,
      y: y + 0.28,
      w: 2.16,
      h: 0.45,
      fontSize: 22,
      bold: true,
      color: INK,
    });
    const change = movement(indicator);
    if (change.text) {
      one.addText(change.text, {
        x: x + 0.12,
        y: y + 0.72,
        w: 2.16,
        h: 0.22,
        fontSize: 9,
        color: change.color,
      });
    }
  });

  const cardRows = Math.ceil(pack.indicators.length / perRow);
  const afterCards = 1.05 + cardRows * 1.15 + 0.15;
  if (pack.sites.length > 0) {
    // The location-wise view, asked for directly: "i need location wise data to be
    // shown in presentation". A table rather than four bar charts, because "which
    // plant is the problem" is a comparison of four numbers per site and a reader
    // should not have to do the joining across charts themselves.
    addTable(
      one,
      "By site",
      ["Site", "Issues", "Resolved", "Open", "Downtime (h)"],
      pack.sites.map((site) => [
        site.site,
        String(site.issues),
        String(site.resolved),
        String(site.open),
        site.downtimeHours.toFixed(1),
      ]),
      { x: 0.35, y: afterCards, w: 12.6 },
      // As many as fit under the cards without spilling off the slide: a row is
      // about 0.32in, and the allowance leaves the header row and a bottom margin.
      Math.max(2, Math.floor((SLIDE_H - afterCards - 0.9) / 0.32)),
    );
  }

  // ---------------------------------------------------------------- slide 2
  const two = deck.addSlide();
  banner(two, shapes, "Where the work is", period);
  addChartGrid(
    two,
    [
      chartNamed("Issues and work logged through the period"),
      chartNamed("Issues by site"),
      chartNamed("Downtime by site"),
      chartNamed("Issues by category"),
    ].filter((chart): chart is DeckChart => Boolean(chart)),
    { x: 0.3, y: 1.0, w: 12.7, h: 6.2 },
    2,
  );

  // ---------------------------------------------------------------- slide 3
  const three = deck.addSlide();
  banner(three, shapes, "Who, what and what keeps breaking", period);

  const recurring = sections.find((section) => section.table)?.table;
  const thirdCharts = [
    chartNamed("Issues by severity"),
    chartNamed("Points by department"),
    chartNamed("Tasks completed by person"),
    chartNamed("Cartridge services by kind"),
    chartNamed("Downtime by asset"),
  ].filter((chart): chart is DeckChart => Boolean(chart));

  if (recurring) {
    // Half the slide for the charts, half for the list — the two things a meeting
    // turns to after the numbers.
    addChartGrid(three, thirdCharts.slice(0, 2), { x: 0.3, y: 1.0, w: 6.3, h: 6.2 }, 1);
    addTable(
      three,
      recurring.title,
      recurring.columns,
      recurring.rows,
      { x: 6.8, y: 1.0, w: 6.2 },
      10,
    );
  } else {
    addChartGrid(three, thirdCharts.slice(0, 4), { x: 0.3, y: 1.0, w: 12.7, h: 6.2 }, 2);
  }

  // Anything the three slides did not have room for goes on one more, rather than
  // being dropped silently: a section somebody deliberately switched ON should
  // appear somewhere, even when the layout above has no slot for it.
  const used = new Set(
    [
      "Issues and work logged through the period",
      "Issues by site",
      "Downtime by site",
      "Issues by category",
      ...thirdCharts.slice(0, recurring ? 2 : 4).map((chart) => chart.title),
    ].filter(Boolean),
  );
  const leftovers = charts.filter((chart) => !used.has(chart.title));
  if (leftovers.length > 0) {
    const four = deck.addSlide();
    banner(four, shapes, "Also this month", period);
    addChartGrid(four, leftovers.slice(0, 6), { x: 0.3, y: 1.0, w: 12.7, h: 6.2 }, 3);
  }

  await deck.writeFile({ fileName: filename });
}
