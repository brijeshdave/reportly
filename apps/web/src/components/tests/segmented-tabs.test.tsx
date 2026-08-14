// Author: Brijesh Dave <https://github.com/brijeshdave>
// The selected segment has to be tellable from its neighbours.
//
// This exists because it was not. Two of the three hand-rolled copies of this
// control marked the chosen segment with `bg-muted` against a plain background —
// a difference invisible enough that it was reported as "the active tab looks
// the same as the others". Colour was also the only signal there was, so a
// screen reader was told nothing at all.
//
// The assertion is on `aria-pressed` rather than on class names: it is the part
// that carries meaning rather than appearance, and it is what a reader uses.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SegmentedTabs } from "@/components/segmented-tabs.js";

const SEGMENTS = [
  { value: "all" as const, label: "All" },
  { value: "mine" as const, label: "Mine" },
];

describe("SegmentedTabs", () => {
  it("says which segment is chosen, in the accessibility tree", () => {
    render(
      <SegmentedTabs ariaLabel="Which view" segments={SEGMENTS} value="mine" onChange={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the chosen one differently from the rest", () => {
    // Not a specific colour — that is a design decision and may change — but that
    // the two are styled differently at all, which is what went wrong.
    render(
      <SegmentedTabs ariaLabel="Which view" segments={SEGMENTS} value="mine" onChange={vi.fn()} />,
    );

    const chosen = screen.getByRole("button", { name: "Mine" });
    const other = screen.getByRole("button", { name: "All" });
    expect(chosen.className).not.toBe(other.className);
  });

  it("names the group, so it is not a row of loose buttons to a reader", () => {
    render(
      <SegmentedTabs ariaLabel="Which view" segments={SEGMENTS} value="all" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("group", { name: "Which view" })).toBeInTheDocument();
  });

  it("reports the segment that was pressed", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedTabs ariaLabel="Which view" segments={SEGMENTS} value="all" onChange={onChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(onChange).toHaveBeenCalledWith("mine");
  });
});
