// Author: Brijesh Dave <https://github.com/brijeshdave>
// How many pages a tour of duty produced.
//
// Small arithmetic, and worth pinning precisely because it is small: it is the
// number a technician's work gets judged by informally, it comes from two
// possible sources, and the interesting cases are the ones where the honest
// answer is "we do not know" rather than a number.
import { describe, expect, it } from "vitest";

import { meanPages, pagesFor, yieldPercent } from "@/entities/part.js";

const tour = (
  meterStart: number | null,
  meterEnd: number | null,
  pagesPrinted: number | null = null,
) => ({ meterStart, meterEnd, pagesPrinted });

describe("pagesFor()", () => {
  it("subtracts the meters when both were read", () => {
    expect(pagesFor(tour(48_120, 49_970))).toEqual({ pages: 1850, from: "meters" });
  });

  it("prefers the meters over a typed count", () => {
    // Both were given and they disagree. The meters are read off the machine;
    // the typed number is somebody's recollection, and this is the one case
    // where the two can be compared and one has to win.
    expect(pagesFor(tour(1000, 2000, 1))).toEqual({ pages: 1000, from: "meters" });
  });

  it("takes the typed count when there are no meters", () => {
    expect(pagesFor(tour(null, null, 1850))).toEqual({ pages: 1850, from: "entered" });
  });

  it("takes the typed count when only one meter was read", () => {
    // One reading answers nothing on its own — a difference needs two.
    expect(pagesFor(tour(48_120, null, 900))).toEqual({ pages: 900, from: "entered" });
    expect(pagesFor(tour(null, 49_970, 900))).toEqual({ pages: 900, from: "entered" });
  });

  it("refuses to report a backwards meter as pages", () => {
    // A meter that went down is a reset counter or a replaced printer. Reporting
    // the difference would be a negative page count; reporting zero would be a
    // confident lie. It says which, so the screen can say "meter reset" rather
    // than "not known" — different words, different fix.
    expect(pagesFor(tour(49_970, 48_120))).toEqual({ pages: null, from: "meter-reset" });
  });

  it("falls back to a typed count when the meter went backwards", () => {
    expect(pagesFor(tour(49_970, 48_120, 1850))).toEqual({ pages: 1850, from: "entered" });
  });

  it("says nothing is known when nothing was recorded", () => {
    expect(pagesFor(tour(null, null))).toEqual({ pages: null, from: "unknown" });
  });

  it("treats an unmoved meter as no pages rather than as unknown", () => {
    // A cartridge that went in and came straight out prints nothing, and zero is
    // the true answer — distinct from never having been measured.
    expect(pagesFor(tour(48_120, 48_120))).toEqual({ pages: 0, from: "meters" });
  });
});

describe("yieldPercent()", () => {
  it("compares the pages against the model's rated figure", () => {
    expect(yieldPercent(1850, 2300)).toBe(80);
    expect(yieldPercent(2300, 2300)).toBe(100);
    // Over is a real answer, not a cap: a cartridge that beat its rating is worth
    // knowing about, and clamping it to 100 would hide the good news.
    expect(yieldPercent(2760, 2300)).toBe(120);
  });

  it("gives nothing rather than a comparison against nothing", () => {
    // A company that has not entered a rated figure gets page counts and no
    // percentage, instead of a division by zero dressed up as a number.
    expect(yieldPercent(1850, null)).toBeNull();
    expect(yieldPercent(null, 2300)).toBeNull();
    expect(yieldPercent(1850, 0)).toBeNull();
  });
});

describe("meanPages()", () => {
  it("averages only the tours that were measured", () => {
    // The unmeasured tour is ignored, not counted as zero: counting it would drag
    // the average down and make a healthy part look like a failing one.
    expect(meanPages([tour(0, 2000), tour(null, null), tour(0, 1000)])).toBe(1500);
  });

  it("gives nothing when nothing was measured", () => {
    expect(meanPages([])).toBeNull();
    expect(meanPages([tour(null, null), tour(null, null)])).toBeNull();
  });
});
