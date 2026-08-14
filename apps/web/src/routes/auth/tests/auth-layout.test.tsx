// Author: Brijesh Dave <https://github.com/brijeshdave>
// The frame around every signed-out screen.
//
// The documentation link is the part worth pinning. Somebody who cannot sign in
// is exactly the person who needs the installation and troubleshooting pages, and
// this is the only route to them from a browser that has never been inside the
// app — so it lives here, on the shared layout, rather than on the sign-in page
// where three of the four screens would miss it.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthLayout } from "@/routes/auth/auth-layout.js";

describe("AuthLayout", () => {
  it("offers the documentation from every signed-out screen", () => {
    render(<AuthLayout title="Sign in to Reportly">form</AuthLayout>);

    const link = screen.getByRole("link", { name: /documentation/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBeTruthy();
  });

  it("opens the documentation in a new tab, safely", () => {
    render(<AuthLayout title="Sign in to Reportly">form</AuthLayout>);

    const link = screen.getByRole("link", { name: /documentation/i });
    // A new tab, so a half-typed form is not thrown away to go and read something.
    expect(link).toHaveAttribute("target", "_blank");
    // And `noreferrer`, because the target is an external site.
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("still renders its title, description and footer around the form", () => {
    render(
      <AuthLayout title="Reset your password" description="We will email you a link" footer="Back">
        <input aria-label="Email" />
      </AuthLayout>,
    );

    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByText("We will email you a link")).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
