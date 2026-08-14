// Author: Brijesh Dave <https://github.com/brijeshdave>
// The behaviour that makes level-by-level picking worth having:
//   - each level offers only what is inside the previous choice
//   - you may stop at any level and use that level
//   - changing a level above discards the choices below it, which are now meaningless
import type { AssetNode } from "@reportly/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AssetCascadePicker } from "@/components/asset-cascade-picker.js";

const asset = (over: Partial<AssetNode> & { id: string; name: string }): AssetNode => ({
  companyId: "c1",
  parentId: null,
  typeId: null,
  typeName: null,
  locationId: null,
  locationName: null,
  status: "active",
  deviceCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** Two plants, each with a "Line 1" holding an identically-named station. */
const tree: AssetNode[] = [
  asset({ id: "kim", name: "Kim" }),
  asset({ id: "kos", name: "Kosamba" }),
  asset({ id: "kim-l1", name: "Line 1", parentId: "kim" }),
  asset({ id: "kos-l1", name: "Line 1", parentId: "kos" }),
  asset({ id: "kim-el", name: "Final EL", parentId: "kim-l1" }),
  asset({ id: "kos-el", name: "Final EL", parentId: "kos-l1" }),
];

describe("AssetCascadePicker", () => {
  it("offers only the roots until one is chosen", () => {
    render(<AssetCascadePicker assets={tree} value={[]} onChange={vi.fn()} />);

    const first = screen.getByRole("combobox");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(first).toHaveTextContent("Kim");
    expect(first).toHaveTextContent("Kosamba");
    // Nothing below a plant is on offer yet — that is what keeps each list short.
    expect(first).not.toHaveTextContent("Final EL");
  });

  it("opens the next level with only that branch's children", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AssetCascadePicker assets={tree} value={[]} onChange={vi.fn()} />);

    await user.selectOptions(screen.getByRole("combobox"), "kim");
    const boxes = screen.getAllByRole("combobox");
    expect(boxes).toHaveLength(2);
    // Kim's Line 1 only. The identically-named line under Kosamba is not here, so
    // the two can never be confused with each other.
    expect(boxes[1]!).toHaveTextContent("Line 1");
  });

  it("lets you stop at a level and use that level", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<AssetCascadePicker assets={tree} value={[]} onChange={onChange} />);

    // Choose the plant and add it without descending — "everything on this plant".
    await user.selectOptions(screen.getByRole("combobox"), "kim");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).toHaveBeenCalledWith(["kim"]);
  });

  it("uses the deepest level chosen", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<AssetCascadePicker assets={tree} value={[]} onChange={onChange} />);

    await user.selectOptions(screen.getAllByRole("combobox")[0]!, "kim");
    await user.selectOptions(screen.getAllByRole("combobox")[1]!, "kim-l1");
    await user.selectOptions(screen.getAllByRole("combobox")[2]!, "kim-el");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).toHaveBeenCalledWith(["kim-el"]);
  });

  it("discards deeper choices when a level above changes", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<AssetCascadePicker assets={tree} value={[]} onChange={onChange} />);

    await user.selectOptions(screen.getAllByRole("combobox")[0]!, "kim");
    await user.selectOptions(screen.getAllByRole("combobox")[1]!, "kim-l1");
    // Switching plant: a station under Kim's line is meaningless under Kosamba, and
    // silently keeping it would file the report against the wrong plant.
    await user.selectOptions(screen.getAllByRole("combobox")[0]!, "kos");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onChange).toHaveBeenCalledWith(["kos"]);
  });

  it("shows the full path of what is chosen, so the two Final ELs are tellable apart", async () => {
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(
      <AssetCascadePicker assets={tree} value={["kos-el"]} onChange={vi.fn()} />,
    );

    // The chosen chip carries the whole path — the point being that the other
    // "Final EL" would read differently.
    expect(screen.getByText("Kosamba › Line 1 › Final EL")).toBeInTheDocument();

    rerender(<AssetCascadePicker assets={tree} value={["kim-el"]} onChange={vi.fn()} />);
    expect(screen.getByText("Kim › Line 1 › Final EL")).toBeInTheDocument();
    expect(screen.queryByText("Kosamba › Line 1 › Final EL")).not.toBeInTheDocument();

    // And while walking down, the pending choice is spelled out too.
    await user.selectOptions(screen.getAllByRole("combobox")[0]!, "kim");
    expect(screen.getByText("Will use")).toBeInTheDocument();
  });

  it("ignores a repeat pick rather than listing it twice", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<AssetCascadePicker assets={tree} value={["kim"]} onChange={onChange} />);

    await user.selectOptions(screen.getAllByRole("combobox")[0]!, "kim");
    await user.click(screen.getByRole("button", { name: "Add" }));

    // Picking the same thing twice is a slip, not an error worth a message.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("replaces rather than appends in single-select mode", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <AssetCascadePicker assets={tree} value={["kim"]} onChange={onChange} multiple={false} />,
    );

    await user.selectOptions(screen.getAllByRole("combobox")[0]!, "kos");
    await user.click(screen.getByRole("button", { name: "Use this" }));

    expect(onChange).toHaveBeenCalledWith(["kos"]);
  });
});
