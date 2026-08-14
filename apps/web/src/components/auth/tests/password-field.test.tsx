// Author: Brijesh Dave <https://github.com/brijeshdave>
// The checklist must reflect the server's rules, not a hardcoded set, and must
// track what the user has typed so far.
import type { PasswordRules } from "@reportly/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PasswordField } from "@/components/auth/password-field.js";

const rules: PasswordRules = {
  minLength: 12,
  requireUppercase: true,
  requireNumber: true,
  requireSymbol: false,
};

function Harness({ rules: given }: { rules?: PasswordRules }) {
  const [value, setValue] = useState("");
  return <PasswordField value={value} onChange={setValue} rules={given} />;
}

/** A rule is satisfied when its row is marked with the success colour. */
function isMet(text: string): boolean {
  const row = screen.getByText(text);
  return row.className.includes("text-success");
}

describe("PasswordField", () => {
  it("lists only the rules the policy enforces", () => {
    render(<Harness rules={rules} />);
    expect(screen.getByText("At least 12 characters")).toBeInTheDocument();
    expect(screen.getByText("An uppercase letter")).toBeInTheDocument();
    expect(screen.getByText("A number")).toBeInTheDocument();
    expect(screen.queryByText("A symbol")).not.toBeInTheDocument();
  });

  it("marks nothing as met for an empty field", () => {
    render(<Harness rules={rules} />);
    expect(isMet("At least 12 characters")).toBe(false);
    expect(isMet("A number")).toBe(false);
  });

  it("ticks each rule as the password satisfies it", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness rules={rules} />);

    await user.type(screen.getByLabelText("Password"), "alllowercase");
    expect(isMet("At least 12 characters")).toBe(true);
    expect(isMet("An uppercase letter")).toBe(false);
    expect(isMet("A number")).toBe(false);

    await user.type(screen.getByLabelText("Password"), "A1");
    expect(isMet("An uppercase letter")).toBe(true);
    expect(isMet("A number")).toBe(true);
  });

  it("hides the checklist when no rules are supplied", () => {
    render(<Harness />);
    expect(screen.queryByText(/At least/)).not.toBeInTheDocument();
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness rules={rules} />);
    const input = screen.getByLabelText("Password");

    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("associates the error with the input for screen readers", () => {
    render(
      <PasswordField
        value="x"
        onChange={vi.fn()}
        label="New password"
        error="Passwords don't match"
      />,
    );
    const input = screen.getByLabelText("New password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Passwords don't match");
  });
});
