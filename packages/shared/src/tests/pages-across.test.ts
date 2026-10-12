// Author: Brijesh Dave <https://github.com/brijeshdave>
// Pages across a printer's readings. The arithmetic both page-count reports are
// built on, so it is tested on its own rather than through either of them.
import { describe, expect, it } from "vitest";

import { pagesAcross } from "@/entities/part.js";

const read = (pages: number, source: "install" | "removal" | "manual" | "reset" = "manual") => ({
  pages,
  source,
});

describe("pagesAcross", () => {
  it("sums the gaps between consecutive readings", () => {
    expect(pagesAcross([read(1000), read(1300), read(1450)])).toBe(450);
  });

  it("says nothing rather than zero when there is nothing to measure", () => {
    // A period a printer was never read in is not a period it printed nothing in.
    expect(pagesAcross([])).toBeNull();
    expect(pagesAcross([read(1000)])).toBeNull();
  });

  it("does not count the step across a reset", () => {
    // The counter started again: a replaced machine, or a cleared total. Counting
    // the step would credit the new printer with everything the old one ever did.
    expect(pagesAcross([read(1000), read(1300), read(5, "reset"), read(205)])).toBe(500);
  });

  it("ignores a backwards step that nobody declared", () => {
    // Should not arise now that readings are checked on the way in, but the old
    // rows are still in the table and a report must not report minus a hundred
    // thousand pages because of one.
    expect(pagesAcross([read(114_381), read(6_712), read(7_000)])).toBe(288);
  });

  it("counts a flat series as zero pages, which is a real answer", () => {
    // Read twice, unchanged: the printer genuinely printed nothing between them.
    expect(pagesAcross([read(1000), read(1000)])).toBe(0);
  });
});
