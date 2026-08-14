// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tests for the `can()` authorization primitive.
import { describe, expect, it } from "vitest";

import { PERMISSIONS, can } from "@/auth/permissions.js";

describe("can()", () => {
  it("grants when the permission is present", () => {
    expect(
      can({ isSuperadmin: false, permissions: [PERMISSIONS.USERS_READ] }, PERMISSIONS.USERS_READ),
    ).toBe(true);
  });

  it("denies when the permission is absent", () => {
    expect(
      can(
        { isSuperadmin: false, permissions: [PERMISSIONS.USERS_READ] },
        PERMISSIONS.USERS_RESET_PASSWORD,
      ),
    ).toBe(false);
  });

  it("superadmin bypasses all checks", () => {
    expect(can({ isSuperadmin: true, permissions: [] }, PERMISSIONS.COMPANIES_DELETE)).toBe(true);
  });
});
