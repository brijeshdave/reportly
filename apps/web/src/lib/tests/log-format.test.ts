// Author: Brijesh Dave <https://github.com/brijeshdave>
import type { LogEntry } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { extraContext, formatRequestSummary, levelTone, requestSummary } from "@/lib/log-format.js";

function entry(context: unknown, msg = "x"): LogEntry {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    ts: "2026-07-11T00:00:00.000Z",
    level: "info",
    feature: "api",
    requestId: null,
    userId: null,
    companyId: null,
    msg,
    context,
  };
}

describe("requestSummary", () => {
  it("reads the incoming-request shape (req.method / req.url)", () => {
    const summary = requestSummary(entry({ req: { method: "GET", url: "/users" } }));
    expect(summary).toEqual({
      method: "GET",
      url: "/users",
      status: undefined,
      durationMs: undefined,
    });
  });

  it("reads the debug-summary shape (flat method/url/status/responseTimeMs)", () => {
    const summary = requestSummary(
      entry({ method: "POST", url: "/login", statusCode: 200, responseTimeMs: 12.7 }),
    );
    expect(summary).toEqual({ method: "POST", url: "/login", status: 200, durationMs: 13 });
  });

  it("is null for a line that is not about a request", () => {
    expect(requestSummary(entry({ signal: "SIGINT" }))).toBeNull();
    expect(requestSummary(entry(null))).toBeNull();
  });
});

describe("formatRequestSummary", () => {
  it("reads as a request line", () => {
    expect(
      formatRequestSummary({ method: "GET", url: "/users", status: 200, durationMs: 11 }),
    ).toBe("GET /users → 200 · 11ms");
  });
});

describe("extraContext", () => {
  it("drops the noise fields but keeps the rest", () => {
    expect(extraContext(entry({ pid: 1, hostname: "h", queries: 3 }))).toEqual({ queries: 3 });
  });

  it("is null when nothing meaningful remains", () => {
    expect(extraContext(entry({ pid: 1, hostname: "h" }))).toBeNull();
  });
});

describe("levelTone", () => {
  it("maps severity to a tone", () => {
    expect(levelTone("error")).toBe("danger");
    expect(levelTone("warn")).toBe("warning");
    expect(levelTone("info")).toBe("info");
    expect(levelTone("debug")).toBe("muted");
  });
});
