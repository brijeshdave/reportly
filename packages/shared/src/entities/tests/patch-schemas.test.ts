// Author: Brijesh Dave <https://github.com/brijeshdave>
// Absent must mean "leave it alone".
//
// This is the test the zod 4 bump needed and did not have. `.partial()` used to
// drop a field's `.default()`; in zod 4 it keeps it, so every update schema in
// the codebase quietly started returning defaults for fields the caller never
// sent — and an update that writes what it parsed then resets them.
//
// Nothing failed to compile. Parsing `{}` through each schema is what showed it:
// editing a severity's name reset its other fields to their defaults, and saving
// any change to a role wiped its permissions.
import {
  updateAssetTypeSchema,
  updateCompanySchema,
  updateDesignationSchema,
  updateGroupSchema,
  updateReportStatusSchema,
  updateRoleSchema,
  updateSeveritySchema,
  updateUserSchema,
} from "@/index.js";
import { describe, expect, it } from "vitest";

/** Every PATCH-shaped schema the app exposes. Add new ones here. */
const PATCH_SCHEMAS = {
  updateAssetTypeSchema,
  updateCompanySchema,
  updateDesignationSchema,
  updateGroupSchema,
  updateReportStatusSchema,
  updateRoleSchema,
  updateSeveritySchema,
  updateUserSchema,
};

describe("update schemas", () => {
  it.each(Object.entries(PATCH_SCHEMAS))(
    "%s invents nothing from an empty patch",
    (_name, schema) => {
      expect(schema.parse({})).toEqual({});
    },
  );

  it("still carries the fields that were actually sent", () => {
    // The other half: stripping defaults must not turn a PATCH into a no-op.
    expect(updateUserSchema.parse({ status: "inactive" })).toEqual({ status: "inactive" });
    expect(updateSeveritySchema.parse({ orderIndex: 5 })).toMatchObject({ orderIndex: 5 });
  });
});
