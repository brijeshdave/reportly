// Author: Brijesh Dave <https://github.com/brijeshdave>
// The regression these pin: drizzle used to throw the driver's error straight
// through, and a `err.code === "23505"` check was enough. It now wraps it in a
// DrizzleQueryError and hangs the pg error off `cause`, so a one-level check
// stopped matching and every duplicate-name 409 quietly became a 500.
import { describe, expect, it } from "vitest";

import { isUniqueViolation } from "@/lib/db-errors.js";

/** What the driver throws: the shape drizzle used to hand us unwrapped. */
function pgError(code: string): Error {
  return Object.assign(new Error("duplicate key value violates unique constraint"), { code });
}

/** What drizzle >=0.45 throws: the driver error, wrapped. */
function wrapped(cause: unknown): Error {
  return Object.assign(new Error("Failed query: insert into ..."), { cause });
}

describe("isUniqueViolation", () => {
  it("recognises the driver error on its own", () => {
    expect(isUniqueViolation(pgError("23505"))).toBe(true);
  });

  it("recognises it through the wrapper drizzle now adds", () => {
    expect(isUniqueViolation(wrapped(pgError("23505")))).toBe(true);
  });

  it("recognises it however deeply it ends up wrapped", () => {
    expect(isUniqueViolation(wrapped(wrapped(pgError("23505"))))).toBe(true);
  });

  it("does not mistake another constraint for a duplicate", () => {
    // A foreign-key violation is a bug in our code, not a name the user can pick,
    // so it must keep bubbling up as a 500 rather than becoming a polite 409.
    expect(isUniqueViolation(wrapped(pgError("23503")))).toBe(false);
  });

  it("is safe on anything that is not an error at all", () => {
    for (const value of [null, undefined, "23505", 23505, {}, new Error("boom")]) {
      expect(isUniqueViolation(value)).toBe(false);
    }
  });

  it("terminates on a cause chain that points at itself", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });
});
