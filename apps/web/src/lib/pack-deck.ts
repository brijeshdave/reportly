// Author: Brijesh Dave <https://github.com/brijeshdave>
// The management pack as a PowerPoint file.
//
// Asked for from use: "i need a dashboard and reposrts that i can show to management
// for each month OR meeting in my presentation ppt… All should be printable and
// exportable for my ppt."
//
// A real .pptx rather than a PDF or a folder of images, because what happens to this
// deck next is *editing*: somebody drops a slide, retitles another, and pastes one
// into a bigger deck. A picture of a report cannot be edited, and a person who has
// to rebuild the deck by hand every month stops using the feature by March.
//
// The library is imported dynamically, at the moment somebody exports. It is close
// to a megabyte, and it has no business being in the bundle of a plant operator who
// only ever files entries.
import type { ManagementPack, PackIndicator } from "@reportly/shared";

import type { ChartImage } from "@/lib/chart-image.js";

/** A chart, already rendered, with the words that belong beside it. */
export interface DeckChart {
  title: string;
  description: string;
  image: ChartImage;
}

/** One slide's worth: a section's heading and the charts under it. */
export interface DeckSection {
  title: string;
  charts: DeckChart[];
  table?: { title: string; columns: string[]; rows: string[][] };
}

const INK = "1F2933";
const MUTED = "6B7280";
const GOOD = "047857";
const BAD = "B91C1C";

/**
 * The figure as it reads on a slide: "12.5 h", "83%", "14" — or a dash.
 *
 * Unmeasured prints as a dash rather than a zero. A slide is the one place a
 * confident zero cannot be questioned: nobody in the room can hover it.
 */
function figure(indicator: PackIndicator): string {
  if (indicator.value === null) return "—";
  const value = Number.isInteger(indicator.value)
    ? String(indicator.value)
    : indicator.value.toFixed(1);
  if (!indicator.unit) return value;
  return indicator.unit === "%" ? `${value}%` : `${value} ${indicator.unit}`;
}

/** "▲ 12% vs last period", or the plain previous figure when a percentage would lie. */
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

/**
 * Build and download the deck.
 *
 * Widescreen, because every projector and every template made this decade is 16:9,
 * and a 4:3 deck pasted into a 16:9 one arrives with grey bars down the sides.
 */
export async function downloadPackDeck(
  pack: ManagementPack,
  sections: DeckSection[],
  filename: string,
): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_16x9";
  deck.title = `${pack.companyName} — ${pack.periodLabel}`;

  // --- title ---------------------------------------------------------------
  const title = deck.addSlide();
  title.addText(pack.companyName || "Reportly", {
    x: 0.6,
    y: 2.1,
    w: 9,
    h: 0.9,
    fontSize: 36,
    bold: true,
    color: INK,
  });
  title.addText(`Operations review — ${pack.periodLabel}`, {
    x: 0.6,
    y: 3.0,
    w: 9,
    h: 0.5,
    fontSize: 20,
    color: MUTED,
  });
  title.addText(
    `Compared with the previous period · generated ${new Date().toLocaleDateString()}`,
    {
      x: 0.6,
      y: 3.6,
      w: 9,
      h: 0.4,
      fontSize: 12,
      color: MUTED,
    },
  );

  // --- the numbers ---------------------------------------------------------
  // Eight to a slide, in two rows of four. More than that and the figures are too
  // small to read from the back of a meeting room, which is the only place this
  // slide is ever read from.
  const perSlide = 8;
  for (let start = 0; start < pack.indicators.length; start += perSlide) {
    const slide = deck.addSlide();
    slide.addText(start === 0 ? "The month in numbers" : "The month in numbers (continued)", {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 0.5,
      fontSize: 22,
      bold: true,
      color: INK,
    });
    pack.indicators.slice(start, start + perSlide).forEach((indicator, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = 0.5 + column * 2.3;
      const y = 1.2 + row * 1.9;
      slide.addText(indicator.label, { x, y, w: 2.1, h: 0.3, fontSize: 11, color: MUTED });
      slide.addText(figure(indicator), {
        x,
        y: y + 0.3,
        w: 2.1,
        h: 0.6,
        fontSize: 28,
        bold: true,
        color: INK,
      });
      const change = movement(indicator);
      if (change.text) {
        slide.addText(change.text, {
          x,
          y: y + 0.95,
          w: 2.1,
          h: 0.3,
          fontSize: 10,
          color: change.color,
        });
      }
    });
  }

  // --- a slide per chart ---------------------------------------------------
  // One chart per slide rather than four: a slide is read from a distance, and the
  // point of a monthly pack is that each picture gets its own moment.
  for (const section of sections) {
    for (const chart of section.charts) {
      const slide = deck.addSlide();
      slide.addText(chart.title, {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.5,
        fontSize: 22,
        bold: true,
        color: INK,
      });
      slide.addText(`${section.title} · ${chart.description}`, {
        x: 0.5,
        y: 0.8,
        w: 9,
        h: 0.35,
        fontSize: 12,
        color: MUTED,
      });
      // Fitted inside the area rather than stretched to it: a bar chart squashed to
      // an arbitrary box is a chart that misreports its own proportions.
      const area = { w: 8.8, h: 4.0 };
      const ratio = Math.min(area.w / chart.image.width, area.h / chart.image.height);
      const w = chart.image.width * ratio;
      const h = chart.image.height * ratio;
      slide.addImage({
        data: chart.image.dataUrl,
        x: 0.5 + (area.w - w) / 2,
        y: 1.3 + (area.h - h) / 2,
        w,
        h,
      });
    }

    if (section.table && section.table.rows.length > 0) {
      const slide = deck.addSlide();
      slide.addText(section.table.title, {
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.5,
        fontSize: 22,
        bold: true,
        color: INK,
      });
      slide.addTable(
        [
          section.table.columns.map((text) => ({
            text,
            options: { bold: true, color: INK, fill: { color: "F3F4F6" } },
          })),
          ...section.table.rows.map((row) =>
            row.map((text) => ({ text, options: { color: INK } })),
          ),
        ],
        { x: 0.5, y: 1.1, w: 9, fontSize: 12, border: { type: "solid", color: "E5E7EB", pt: 1 } },
      );
    }
  }

  await deck.writeFile({ fileName: filename });
}
