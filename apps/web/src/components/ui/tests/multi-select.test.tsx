// Author: Brijesh Dave <https://github.com/brijeshdave>
// Picking several things must not throw away what is already picked — which is
// exactly what a native <select multiple> does on a click without ctrl held, and
// the reason this control exists.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MultiSelect } from "@/components/ui/multi-select.js";

const SITES = [
  { value: "1", label: "Mumbai" },
  { value: "2", label: "Pune" },
  { value: "3", label: "Delhi" },
];

describe("MultiSelect", () => {
  it("says what nothing-picked means, rather than showing an empty box", async () => {
    render(
      <MultiSelect
        label="Sites"
        options={SITES}
        selected={[]}
        onChange={vi.fn()}
        emptyLabel="All sites"
      />,
    );
    expect(screen.getByLabelText("Sites")).toHaveTextContent("All sites");
  });

  it("adds to the selection instead of replacing it", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();

    render(<MultiSelect label="Sites" options={SITES} selected={["1"]} onChange={onChange} />);

    await user.click(screen.getByLabelText("Sites"));
    await user.click(screen.getByText("Pune"));

    // Mumbai is kept. A native multi-select would have dropped it.
    expect(onChange).toHaveBeenCalledWith(["1", "2"]);
  });

  it("removes one that was already picked", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();

    render(<MultiSelect label="Sites" options={SITES} selected={["1", "2"]} onChange={onChange} />);

    await user.click(screen.getByLabelText("Sites"));
    await user.click(screen.getByText("Mumbai"));

    expect(onChange).toHaveBeenCalledWith(["2"]);
  });

  it("names what is picked, and counts once the names would not fit", () => {
    const { rerender } = render(
      <MultiSelect label="Sites" options={SITES} selected={["1", "2"]} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Sites")).toHaveTextContent("Mumbai, Pune");

    rerender(
      <MultiSelect label="Sites" options={SITES} selected={["1", "2", "3"]} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Sites")).toHaveTextContent("3 of 3");
  });

  it("clears back to the empty meaning", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();

    render(
      <MultiSelect
        label="Sites"
        options={SITES}
        selected={["1"]}
        onChange={onChange}
        emptyLabel="All sites"
      />,
    );

    await user.click(screen.getByLabelText("Sites"));
    await user.click(screen.getByText(/clear/i));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("stays open while several are ticked", async () => {
    const user = userEvent.setup({ delay: null });
    render(<MultiSelect label="Sites" options={SITES} selected={[]} onChange={vi.fn()} />);

    await user.click(screen.getByLabelText("Sites"));
    await user.click(screen.getByText("Mumbai"));

    // The list is still there — picking a second site must not need a second open.
    expect(screen.getByText("Pune")).toBeVisible();
  });
});
