// Author: Brijesh Dave <https://github.com/brijeshdave>
// Representative entity-contract test covering create/update parsing rules.
import { describe, expect, it } from "vitest";

import { createUserSchema, updateUserSchema } from "@/entities/user.js";

/** A user needs a username to sign in with, so every valid fixture carries one. */
const valid = { name: "Ada Lovelace", email: "ada@example.com", username: "ada" };

describe("createUserSchema", () => {
  it("accepts a valid user and defaults status to active", () => {
    expect(createUserSchema.parse(valid).status).toBe("active");
  });

  it("trims the name and rejects an empty one", () => {
    expect(createUserSchema.parse({ ...valid, name: "  Ada  " }).name).toBe("Ada");
    expect(createUserSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(createUserSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  // The rest of the file spreads `valid`, so nothing else would notice if the
  // username stopped being required — which is how it went unguarded before.
  it("requires a username, since it is a way to sign in", () => {
    const { username: _username, ...withoutUsername } = valid;
    expect(createUserSchema.safeParse(withoutUsername).success).toBe(false);
  });
});

describe("updateUserSchema", () => {
  it("allows partial updates", () => {
    expect(updateUserSchema.parse({ status: "inactive" })).toEqual({ status: "inactive" });
  });
});
