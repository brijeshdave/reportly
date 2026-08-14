// Author: Brijesh Dave <https://github.com/brijeshdave>
// A tag's colour is arbitrary, so the chip computes its own text colour. These
// tests pin the readable-contrast rule, because getting it wrong produces a chip
// that looks fine in one theme and is unreadable in the other — and nobody
// reviewing a diff spots that.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TagChip, TagList, readableTextOn } from "@/components/tag-chip.js";

describe("readableTextOn", () => {
  it("puts dark text on a light colour", () => {
    expect(readableTextOn("#eab308")).toBe("#111827"); // amber
    expect(readableTextOn("#84cc16")).toBe("#111827"); // lime
    expect(readableTextOn("#ffffff")).toBe("#111827");
  });

  it("puts light text on a dark colour", () => {
    expect(readableTextOn("#0f766e")).toBe("#ffffff"); // deep teal
    expect(readableTextOn("#000000")).toBe("#ffffff");
  });

  it("chooses accessibility over convention on a mid-tone", () => {
    // Blue-500 is conventionally shown with white text, and that convention fails
    // WCAG AA for text this small: white scores 3.64 against black's 5.77. The chip
    // is 11-12px, so the ratio decides rather than the habit. If a chip ever looks
    // unexpectedly dark, this is why — and it is legible, which the habit is not.
    expect(readableTextOn("#3b82f6")).toBe("#111827");
  });

  it("weights green far above blue, as perception does", () => {
    // Pure blue is much darker to the eye than pure green at the same channel
    // value. A naive average of the channels would call both mid-grey and get one
    // of them wrong; the sRGB-linear luminance formula is what makes this right.
    expect(readableTextOn("#00ff00")).toBe("#111827");
    expect(readableTextOn("#0000ff")).toBe("#ffffff");
  });

  it("falls back to the theme's own colour rather than throwing", () => {
    // This runs in a render path, so a malformed colour from the API must not take
    // the page down with it.
    expect(readableTextOn("nonsense")).toBe("inherit");
    expect(readableTextOn("#abc")).toBe("inherit");
  });
});

describe("TagChip", () => {
  it("paints the tag colour and keeps the full name available on hover", () => {
    render(<TagChip name="a very long tag name that will not fit" color="#3b82f6" />);
    const chip = screen.getByTitle("a very long tag name that will not fit");
    expect(chip).toHaveStyle({ backgroundColor: "#3b82f6" });
  });

  it("offers removal only when a handler is given", () => {
    const { rerender } = render(<TagChip name="safety" color="#ef4444" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<TagChip name="safety" color="#ef4444" onRemove={() => {}} />);
    expect(screen.getByRole("button", { name: "Remove safety" })).toBeInTheDocument();
  });
});

describe("TagList", () => {
  it("renders the empty fallback when there are no tags", () => {
    // An untagged record should read as untagged, not as a blank gap.
    render(<TagList tags={[]} empty={<span>No tags</span>} />);
    expect(screen.getByText("No tags")).toBeInTheDocument();
  });

  it("renders one chip per tag", () => {
    render(
      <TagList
        tags={[
          { id: "1", name: "safety", color: "#ef4444" },
          { id: "2", name: "leak", color: "#3b82f6" },
        ]}
      />,
    );
    expect(screen.getByTitle("safety")).toBeInTheDocument();
    expect(screen.getByTitle("leak")).toBeInTheDocument();
  });
});
