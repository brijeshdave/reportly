// Author: Brijesh Dave <https://github.com/brijeshdave>
// TRUST_PROXY decides whether request.ip is the caller or the proxy in front of
// it, and every per-IP rate limit and audit IP rides on that. The one value that
// must never be reachable by accident is unbounded trust, because it lets any
// client forge X-Forwarded-For and pick its own IP — so `true` is only ever the
// literal string, never the empty default.
import { describe, expect, it } from "vitest";

import { parseTrustProxy } from "@/core/env.js";

describe("parseTrustProxy", () => {
  it("trusts no proxy by default", () => {
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("   ")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
  });

  it("reads a hop count as a number", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
  });

  it("reads a list of proxy addresses", () => {
    expect(parseTrustProxy("10.0.0.0/8, 127.0.0.1")).toEqual(["10.0.0.0/8", "127.0.0.1"]);
  });

  it("allows unbounded trust only when it is spelled out", () => {
    // The dangerous value is deliberately unreachable except by writing it.
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("")).not.toBe(true);
  });
});
