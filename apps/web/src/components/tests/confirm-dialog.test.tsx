// Author: Brijesh Dave <https://github.com/brijeshdave>
// A refused destructive action (last superadmin, system group) must explain itself
// in place rather than closing as if it had worked.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/confirm-dialog.js";

const onConfirm = vi.fn();
const onClose = vi.fn();

function renderDialog(props = {}) {
  return render(
    <ConfirmDialog
      open
      title="Delete this group?"
      description="Its members lose the permissions it granted."
      confirmLabel="Delete group"
      destructive
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  onConfirm.mockResolvedValue(undefined);
});

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="x"
        description="y"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("confirms and then closes", async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Delete group" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open and explains a refusal", async () => {
    onConfirm.mockRejectedValue(new Error("The Superadmin group must keep at least one member"));
    const user = userEvent.setup({ delay: null });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Delete group" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("must keep at least one member");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels without acting", async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup({ delay: null });
    renderDialog();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
