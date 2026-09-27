// Author: Brijesh Dave <https://github.com/brijeshdave>
// The field-error contract: what a validation failure is called, on both sides of
// the wire. The API flattens fastify's list with it and the browser flattens its own
// parse with it, so a disagreement here is a server refusal that lands on no field.
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fieldErrorsFrom, fieldPathOf, hasFieldErrors } from "@/errors.js";

describe("fieldPathOf", () => {
  it("joins a path into the key a form indexes its state by", () => {
    expect(fieldPathOf(["title"])).toBe("title");
    // An array index is a segment like any other — the form's own key for that row.
    expect(fieldPathOf(["targets", 0, "assetId"])).toBe("targets.0.assetId");
  });

  it("is empty for the object as a whole", () => {
    expect(fieldPathOf([])).toBe("");
  });
});

describe("fieldErrorsFrom", () => {
  it("keeps the first complaint per field", () => {
    // A field with two problems is still one field with one message under it, and the
    // first is the one a person fixes. Showing both would move the layout for nothing.
    const fields = fieldErrorsFrom([
      { path: ["title"], message: "Too short" },
      { path: ["title"], message: "Also wrong somehow" },
    ]);
    expect(fields).toEqual({ title: "Too short" });
  });

  it("leaves a whole-object rule out of the field map", () => {
    // A cross-field refine that names no path — "the end time cannot be before the
    // start time" — has no input to sit under. It belongs to the form-level message,
    // and putting it under an arbitrary field would blame the wrong one.
    const fields = fieldErrorsFrom([
      { path: [], message: "Something is inconsistent" },
      { path: ["endedAt"], message: "Before it started" },
    ]);
    expect(fields).toEqual({ endedAt: "Before it started" });
  });

  it("reads a real zod parse the same way the API reads fastify's list", () => {
    // The point of the shared function: the browser validates against the very schema
    // the route does, so the keys it produces must be the keys the server sends back.
    const schema = z.object({
      title: z.string().min(1),
      targets: z.array(z.object({ assetId: z.string().uuid() })),
    });
    const result = schema.safeParse({ title: "", targets: [{ assetId: "not-a-uuid" }] });
    expect(result.success).toBe(false);

    const fields = fieldErrorsFrom(result.error!.issues);
    expect(Object.keys(fields).sort()).toEqual(["targets.0.assetId", "title"]);
  });
});

describe("hasFieldErrors", () => {
  it("is false for a refusal with no field to blame", () => {
    // A 403 or a missing row is not about anything the person typed.
    expect(hasFieldErrors({ error: { code: "FORBIDDEN", message: "No" } })).toBe(false);
    expect(hasFieldErrors({ error: { code: "VALIDATION_ERROR", message: "No", fields: {} } })).toBe(
      false,
    );
  });

  it("is true once a field is named", () => {
    expect(
      hasFieldErrors({
        error: { code: "VALIDATION_ERROR", message: "No", fields: { title: "Required" } },
      }),
    ).toBe(true);
  });
});
