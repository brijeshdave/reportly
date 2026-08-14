// Author: Brijesh Dave <https://github.com/brijeshdave>
// Barrel smoke test: the public entry re-exports the core contracts.
import { describe, expect, it } from "vitest";

import { ERROR_CODES, PERMISSIONS, listQuerySchema, userSchema } from "@/index.js";

describe("@reportly/shared barrel", () => {
  it("re-exports the core contracts", () => {
    expect(ERROR_CODES.NOT_FOUND).toBe("NOT_FOUND");
    expect(PERMISSIONS.USERS_READ).toBe("users:read");
    expect(typeof listQuerySchema.parse).toBe("function");
    expect(typeof userSchema.parse).toBe("function");
  });
});
