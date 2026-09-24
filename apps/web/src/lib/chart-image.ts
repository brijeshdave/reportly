// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning a chart that is on the screen into a picture that can go in a deck.
//
// Asked for from use: "All should be printable and exportable for my ppt." A chart
// in a browser is an SVG built by recharts; PowerPoint wants a bitmap. This is the
// bridge, and it is deliberately the *only* one: the pack's slides and its per-chart
// download both come through here, so a picture in the deck is the picture on the
// screen rather than a second rendering that might differ.
//
// Why not render the chart again server-side: it would mean a second chart engine,
// on a machine with no fonts and no theme, producing something subtly unlike what
// the person clicking "export" is looking at. The browser already drew it.

/**
 * Inline what CSS is saying, because a serialised SVG loses its stylesheet.
 *
 * Recharts sets most colours as attributes, which survive; anything wearing a class
 * — axis labels, the grid — is styled by the page and would come out black on
 * black in dark mode. Reading the computed style and writing it onto the clone is
 * what keeps the exported picture looking like the chart.
 */
function inlineStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const sourceNodes = source.querySelectorAll("*");
  const cloneNodes = clone.querySelectorAll("*");
  for (let i = 0; i < sourceNodes.length; i += 1) {
    const computed = window.getComputedStyle(sourceNodes[i]!);
    const target = cloneNodes[i] as SVGElement | undefined;
    if (!target) continue;
    for (const property of [
      "fill",
      "stroke",
      "stroke-width",
      "font-family",
      "font-size",
      "opacity",
    ]) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  }
}

/**
 * The chart's own SVG, which is not the first one in the card.
 *
 * A chart card carries icons — the Table toggle, the PNG button — and every one of
 * them is a 12×12 `<svg>` that comes *before* the chart in document order. Taking
 * the first match exported a stroke-only chevron with `stroke="currentColor"`,
 * which rasterised to the browser's broken-image glyph: every chart in the first
 * exported deck was a 1 KB placeholder. Found by opening the deck, not by a test
 * that counted the images.
 *
 * The biggest one is the chart, by a wide margin, so area is the test rather than a
 * class name the charting library is free to rename.
 */
function chartSurface(element: HTMLElement): SVGSVGElement | null {
  let best: SVGSVGElement | null = null;
  let bestArea = 0;
  for (const svg of element.querySelectorAll("svg")) {
    const rect = svg.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = svg as SVGSVGElement;
      bestArea = area;
    }
  }
  // An icon is a few hundred square pixels; a chart is tens of thousands. Below
  // that floor there is no chart on this card, and exporting an icon as though it
  // were one is worse than exporting nothing.
  return bestArea >= 5000 ? best : null;
}

/**
 * Grow every text node's font size, and darken it.
 *
 * The axis labels wear a muted grey that reads well beside a chart on screen and
 * disappears in a projected slide, so the exported copy takes a stronger ink.
 */
function growText(clone: SVGSVGElement, factor: number): void {
  for (const node of clone.querySelectorAll("text, tspan")) {
    const element = node as SVGElement;
    const current = Number.parseFloat(element.style.fontSize || "11");
    if (Number.isFinite(current)) {
      element.style.setProperty("font-size", `${Math.round(current * factor)}px`);
    }
    element.style.setProperty("font-weight", "600");
    element.style.setProperty("fill", "#1f2933");
  }
}

export interface ChartImage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Render the first SVG inside `element` as a PNG data URL.
 *
 * Drawn at twice the on-screen size: a slide is projected, and a chart captured at
 * CSS pixels looks soft the moment it is on a wall. `background` is painted first
 * because a PNG with a transparent background lands on a white slide with dark-mode
 * text on it, which is unreadable.
 */
export async function chartToPng(
  element: HTMLElement,
  background = "#ffffff",
  scale = 3,
  /**
   * How much to grow the chart's text before rasterising.
   *
   * Reported from use: "in all charts any fonts are not readable only chart being
   * seen". A chart on screen is ~900px wide with 11px labels; the same picture in a
   * six-inch slide panel is a third of that, so the labels land at about 4px. They
   * are scaled here rather than on screen, because the screen is fine — it is the
   * picture that is read from across a room.
   *
   * Modest on purpose. The first attempt at 1.9× made the labels legible and then
   * made them collide: text is grown *after* the chart has laid its ticks out, so
   * the library has already decided how many will fit at the original size. 1.35
   * clears the readability problem without running the dates into each other.
   */
  textScale = 1.35,
): Promise<ChartImage | null> {
  const svg = chartSurface(element);
  if (!svg) return null;

  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  growText(clone, textScale);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const xml = new XMLSerializer().serializeToString(clone);
  // `encodeURIComponent` rather than `btoa`: a chart label can hold any character
  // somebody typed into a category name, and btoa throws on the first one outside
  // Latin-1 — which is a crash on export for exactly the installations that name
  // things in their own language.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

  const image = new Image();
  image.decoding = "sync";
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = url;
  if (!(await loaded)) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

/** Save a data URL as a file, the same way the list exports do. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
