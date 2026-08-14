// Author: Brijesh Dave <https://github.com/brijeshdave>
// A render failure must not blank the page, and it must be reported into the
// server log pipeline rather than lost in the browser console.
import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/error-boundary.js";
import * as logs from "@/services/logs.js";

function Boom(): JSX.Element {
  throw new Error("kaboom");
}

beforeEach(() => {
  // React logs the caught error; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

it("shows a recoverable fallback instead of crashing", () => {
  render(
    <ErrorBoundary boundary="test">
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("reports the error to the client log endpoint", () => {
  const report = vi.spyOn(logs, "reportClientLog").mockResolvedValue(undefined);

  render(
    <ErrorBoundary boundary="test-boundary">
      <Boom />
    </ErrorBoundary>,
  );

  expect(report).toHaveBeenCalledTimes(1);
  const payload = report.mock.calls[0]![0];
  expect(payload.level).toBe("error");
  expect(payload.msg).toBe("kaboom");
  expect(payload.context).toMatchObject({ boundary: "test-boundary" });
});

it("renders children when nothing throws", () => {
  render(
    <ErrorBoundary>
      <span>all good</span>
    </ErrorBoundary>,
  );
  expect(screen.getByText("all good")).toBeInTheDocument();
});
