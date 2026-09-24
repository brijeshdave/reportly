// Author: Brijesh Dave <https://github.com/brijeshdave>
// The management pack as a PowerPoint file — four dense slides, dressed like the
// dashboard it comes from.
//
// Asked for from use, in order: "i need a dashboard and reposrts that i can show to
// management for each month OR meeting in my presentation ppt"; then "i dont need
// thease many slides. i need 2-3 slides that can acomodate all infor"; then "i had
// shown you a Power BI dashboar dearlier, i need that kind of ui for ppt".
//
// So the deck is a dashboard rather than a report: a dark title band across the top
// of every slide, KPI cards with a coloured rule and a large figure, charts in
// panels with their own headings, tables with a dark header row and banded rows.
// The shape is fixed:
//
//   1. **The month at a glance** — the cards, then the by-site table.
//   2. **Where the work is** — the trend, by site, by category, by severity.
//   3. **Reliability** — worst assets, downtime by site, what keeps coming back.
//   4. **People** — per person, and nothing else, because that is what was asked.
//
// A real .pptx rather than a PDF or a folder of images, because what happens to this
// deck next is *editing*. The library is imported dynamically, at the moment
// somebody exports: it is close to a megabyte and has no business in the bundle of a
// plant operator who only files entries.
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

/**
 * The palette, taken from the dashboard this deck imitates: a navy band, near-black
 * ink on white panels, and one accent per card so a row of figures reads as a row of
 * figures rather than as a wall of text.
 */
const BAND = "13314B";
const BAND_SOFT = "C7D6E4";
const INK = "1F2933";
const MUTED = "6B7280";
const PANEL = "FFFFFF";
const PAGE = "F4F6F9";
const LINE = "E3E8EF";
const ZEBRA = "F8FAFC";
const GOOD = "047857";
const BAD = "B91C1C";
const ACCENT = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300"];

/**
 * The slide, in inches.
 *
 * `LAYOUT_WIDE` and not `LAYOUT_16x9`: both are 16:9, but the library's `16x9`
 * preset is a 10 × 5.625 inch slide while `WIDE` is 13.33 × 7.5, and every
 * coordinate below is written against the larger one.
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
    return { text: indicator.previous === null ? "" : `was ${indicator.previous}`, color: MUTED };
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

type Slide = PptxGenJSType.Slide;
type Shapes = { rect: PptxGenJSType.ShapeType };

/** Every slide: the page tint and the navy band with the period on the right. */
function frame(slide: Slide, shapes: Shapes, title: string, right: string): void {
  slide.background = { color: PAGE };
  slide.addShape(shapes.rect, { x: 0, y: 0, w: SLIDE_W, h: 0.9, fill: { color: BAND } });
  slide.addText(title, {
    x: 0.4,
    y: 0.1,
    w: 8.4,
    h: 0.7,
    fontSize: 24,
    bold: true,
    color: "FFFFFF",
    valign: "middle",
  });
  slide.addText(right, {
    x: SLIDE_W - 5.0,
    y: 0.1,
    w: 4.6,
    h: 0.7,
    fontSize: 13,
    color: BAND_SOFT,
    align: "right",
    valign: "middle",
  });
}

/** A white panel with a heading — what every chart and table sits on. */
function panel(
  slide: Slide,
  shapes: Shapes,
  at: { x: number; y: number; w: number; h: number },
  heading: string,
  accent: string,
): void {
  slide.addShape(shapes.rect, {
    ...at,
    fill: { color: PANEL },
    line: { color: LINE, width: 1 },
  });
  slide.addShape(shapes.rect, { x: at.x, y: at.y, w: 0.07, h: at.h, fill: { color: accent } });
  slide.addText(heading, {
    x: at.x + 0.2,
    y: at.y + 0.06,
    w: at.w - 0.4,
    h: 0.32,
    fontSize: 12,
    bold: true,
    color: INK,
  });
}

/**
 * Charts in a grid, each in its own panel and fitted inside it.
 *
 * Fitted rather than stretched: a bar chart squashed into an arbitrary box is a chart
 * that misreports its own proportions, which on a slide nobody can interrogate is
 * simply a wrong picture.
 */
function addChartGrid(
  slide: Slide,
  shapes: Shapes,
  charts: DeckChart[],
  area: { x: number; y: number; w: number; h: number },
  columns: number,
): void {
  if (charts.length === 0) return;
  const rows = Math.ceil(charts.length / columns);
  const gap = 0.16;
  const cellW = (area.w - gap * (columns - 1)) / columns;
  const cellH = (area.h - gap * (rows - 1)) / rows;

  charts.forEach((chart, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = area.x + column * (cellW + gap);
    const y = area.y + row * (cellH + gap);
    panel(slide, shapes, { x, y, w: cellW, h: cellH }, chart.title, ACCENT[index % ACCENT.length]!);

    const imageArea = { w: cellW - 0.35, h: cellH - 0.55 };
    const ratio = Math.min(imageArea.w / chart.image.width, imageArea.h / chart.image.height);
    const w = chart.image.width * ratio;
    const h = chart.image.height * ratio;
    slide.addImage({
      data: chart.image.dataUrl,
      x: x + 0.2 + (imageArea.w - w) / 2,
      y: y + 0.45 + (imageArea.h - h) / 2,
      w,
      h,
    });
  });
}

/** A table in a panel: dark header, banded rows, right-aligned numbers. */
function addTable(
  slide: Slide,
  shapes: Shapes,
  title: string,
  columns: string[],
  rows: string[][],
  at: { x: number; y: number; w: number; h: number },
  accent: string,
): void {
  if (rows.length === 0) return;
  panel(slide, shapes, at, title, accent);

  // A row is about 0.3in at this size; keep what fits inside the panel.
  const limit = Math.max(2, Math.floor((at.h - 0.85) / 0.3));
  const body = rows.slice(0, limit).map((row, index) =>
    row.map((text, column) => ({
      text,
      options: {
        color: INK,
        fontSize: 11,
        align: column === 0 ? ("left" as const) : ("right" as const),
        fill: { color: index % 2 === 1 ? ZEBRA : PANEL },
      },
    })),
  );

  slide.addTable(
    [
      columns.map((text, column) => ({
        text,
        options: {
          bold: true,
          color: "FFFFFF",
          fontSize: 11,
          fill: { color: BAND },
          align: column === 0 ? ("left" as const) : ("right" as const),
        },
      })),
      ...body,
    ],
    {
      x: at.x + 0.15,
      y: at.y + 0.45,
      w: at.w - 0.3,
      fontSize: 11,
      border: { type: "solid", color: LINE, pt: 1 },
    },
  );
}

/** What the caller chose to put on the deck. */
export interface DeckOptions {
  /** Indicator keys to show on slide 1, in the pack's own order. Empty means all. */
  indicatorKeys?: string[];
}

/**
 * Build and download the deck.
 *
 * Charts are pulled by title rather than by position, so a section switched off
 * leaves a gap in a grid instead of shuffling an unrelated chart onto the wrong
 * slide.
 */
export async function downloadPackDeck(
  pack: ManagementPack,
  sections: DeckSection[],
  filename: string,
  options: DeckOptions = {},
): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.title = `${pack.companyName} — ${pack.periodLabel}`;
  const shapes: Shapes = { rect: deck.ShapeType.rect };

  const charts = sections.flatMap((section) => section.charts);
  const named = (title: string) => charts.find((chart) => chart.title === title);
  const pick = (...titles: string[]) =>
    titles.map(named).filter((chart): chart is DeckChart => Boolean(chart));
  const period = `${pack.periodLabel}  ·  compared with the previous period`;
  const heading = `${pack.companyName || "Operations"} — ${pack.periodLabel}`;

  // ---------------------------------------------------------------- slide 1
  const one = deck.addSlide();
  frame(one, shapes, heading, period);

  // Only the indicators the caller ticked. The checklist is the answer to "i want to
  // control what indicators to be shown in ppt"; the page still shows them all.
  const chosen =
    options.indicatorKeys && options.indicatorKeys.length > 0
      ? pack.indicators.filter((indicator) => options.indicatorKeys!.includes(indicator.key))
      : pack.indicators;

  const perRow = 5;
  chosen.forEach((indicator, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    const x = 0.35 + column * 2.56;
    const y = 1.1 + row * 1.2;
    one.addShape(shapes.rect, {
      x,
      y,
      w: 2.4,
      h: 1.05,
      fill: { color: PANEL },
      line: { color: LINE, width: 1 },
    });
    one.addShape(shapes.rect, {
      x,
      y,
      w: 2.4,
      h: 0.06,
      fill: { color: ACCENT[index % ACCENT.length]! },
    });
    one.addText(indicator.label.toUpperCase(), {
      x: x + 0.14,
      y: y + 0.12,
      w: 2.12,
      h: 0.24,
      fontSize: 9,
      bold: true,
      color: MUTED,
      charSpacing: 0.4,
    });
    one.addText(figure(indicator), {
      x: x + 0.14,
      y: y + 0.33,
      w: 2.12,
      h: 0.45,
      fontSize: 24,
      bold: true,
      color: INK,
    });
    const change = movement(indicator);
    if (change.text) {
      one.addText(change.text, {
        x: x + 0.14,
        y: y + 0.78,
        w: 2.12,
        h: 0.22,
        fontSize: 9,
        bold: true,
        color: change.color,
      });
    }
  });

  const cardRows = Math.ceil(chosen.length / perRow);
  const afterCards = 1.1 + cardRows * 1.2 + 0.1;
  if (pack.sites.length > 0 && afterCards < SLIDE_H - 1.2) {
    // The location-wise view, asked for directly, and carrying what was asked for
    // with it: "same need for per site in table within same table on 1st slide
    // include issues, cartridge refill, repair, tasks and routines".
    const kinds = pack.serviceKinds;
    addTable(
      one,
      shapes,
      "By site",
      ["Site", "Issues", "Open", "Down (h)", ...kinds, "Tasks", "Routines"],
      pack.sites.map((site) => [
        site.site,
        String(site.issues),
        String(site.open),
        site.downtimeHours.toFixed(1),
        ...kinds.map((kind) => String(site.services[kind] ?? 0)),
        String(site.tasks),
        String(site.routines),
      ]),
      { x: 0.35, y: afterCards, w: 12.63, h: SLIDE_H - afterCards - 0.3 },
      ACCENT[0]!,
    );
  }

  // ---------------------------------------------------------------- slide 2
  // "second slide has relavent chart data, from third slide issue by severity move
  // to second slide."
  const activity = pick(
    "Issues and work logged through the period",
    "Issues by site",
    "Issues by category",
    "Issues by severity",
    "Issues by department",
    "Where entries stand",
  ).slice(0, 4);
  if (activity.length > 0) {
    const two = deck.addSlide();
    frame(two, shapes, "Where the work is", period);
    addChartGrid(two, shapes, activity, { x: 0.35, y: 1.05, w: 12.63, h: 6.1 }, 2);
  }

  // ---------------------------------------------------------------- slide 3
  //
  // Only when there is something to put on it. A quiet month — no stoppages, nothing
  // recurring — used to produce a slide carrying a title band and white space, which
  // is a blank somebody has to apologise for mid-meeting.
  const recurring = sections.find((section) => section.table)?.table;
  const hasRecurring = Boolean(recurring && recurring.rows.length > 0);
  const reliability = pick("Downtime by asset", "Downtime by site", "Downtime through the period");
  if (reliability.length > 0 || hasRecurring) {
    const three = deck.addSlide();
    frame(three, shapes, "Reliability and what keeps breaking", period);
    if (hasRecurring && reliability.length > 0) {
      addChartGrid(three, shapes, reliability.slice(0, 2), { x: 0.35, y: 1.05, w: 6.2, h: 6.1 }, 1);
      addTable(
        three,
        shapes,
        recurring!.title,
        recurring!.columns,
        recurring!.rows,
        { x: 6.75, y: 1.05, w: 6.23, h: 6.1 },
        ACCENT[1]!,
      );
    } else if (hasRecurring) {
      addTable(
        three,
        shapes,
        recurring!.title,
        recurring!.columns,
        recurring!.rows,
        { x: 0.35, y: 1.05, w: 12.63, h: 6.1 },
        ACCENT[1]!,
      );
    } else {
      addChartGrid(three, shapes, reliability, { x: 0.35, y: 1.05, w: 12.63, h: 6.1 }, 2);
    }
  }

  // ---------------------------------------------------------------- slide 4
  // "in 4th slide need only points by person, entries filled for person, routines by
  // person and task completed by person, cartridges refilled and repaired by person.
  // dont need any other details."
  const people = pick(
    "Points by person",
    "Entries filed by person",
    "Routines by person",
    "Tasks completed by person",
    "Cartridges serviced by person",
  );
  if (people.length > 0) {
    const four = deck.addSlide();
    frame(four, shapes, "People", period);
    addChartGrid(four, shapes, people, { x: 0.35, y: 1.05, w: 12.63, h: 6.1 }, 3);
  }

  await deck.writeFile({ fileName: filename });
}
