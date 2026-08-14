// Author: Brijesh Dave <https://github.com/brijeshdave>
// An error the user can report: the message, plus the request id that pulls up
// every log line for the failed request.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { ApiError } from "@/services/http.js";

function apiError(message: string, requestId: string | null): ApiError {
  return new ApiError(500, { error: { code: "INTERNAL_ERROR", message } }, requestId);
}

describe("ErrorAlert", () => {
  it("shows the message and the reference id from an API error", () => {
    render(<ErrorAlert error={apiError("Something broke", "req-123")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something broke");
    expect(screen.getByRole("alert")).toHaveTextContent("Reference ID: req-123");
  });

  it("omits the reference when there is no request id", () => {
    render(<ErrorAlert error={apiError("Bad thing", null)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Bad thing");
    expect(screen.queryByText(/Reference ID/)).not.toBeInTheDocument();
  });

  it("falls back for a non-API error", () => {
    render(<ErrorAlert error={new Error("plain failure")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("plain failure");
    expect(screen.queryByText(/Reference ID/)).not.toBeInTheDocument();
  });
});
