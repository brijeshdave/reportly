// Author: Brijesh Dave <https://github.com/brijeshdave>
// Guards the system-role permission mapping (pure; no DB). The full idempotent
// seed is exercised against a real database in the Step 2 verify.
import { ALL_PERMISSIONS } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { AREA_ROLES, permissionsFor } from "@/core/db/seed/index.js";

describe("permissionsFor", () => {
  it("Superadmin and Admin get every permission", () => {
    expect(permissionsFor("Superadmin")).toHaveLength(ALL_PERMISSIONS.length);
    expect(permissionsFor("Admin")).toHaveLength(ALL_PERMISSIONS.length);
  });

  it("Manager can read/create/update but not delete, and can appraise reports", () => {
    const manager = permissionsFor("Manager");
    expect(manager).toContain("users:update");
    expect(manager).not.toContain("users:reset-password");
    expect(manager).not.toContain("roles:clone");
    // Appraising a downline's reports is a manager act; it ends in :appraise, so it
    // is granted explicitly rather than by the read/create/update regex.
    expect(manager).toContain("journal:appraise");
    expect(manager).not.toContain("journal-config:manage");
  });

  it("Member is read-only, except for their own reports, downtime, files and tasks", () => {
    const member = permissionsFor("Member");
    // The non-read grants, and why each is here: everyone files their own reports,
    // and the person who filed one is the person standing at the machine that went
    // down, so they record and close its downtime too, and attach the photo of it.
    // tasks:update is how the person a task was given to marks it done.
    // comments:update lets them correct their own remark — but NOT delete it, which
    // is why comments:delete is absent below. The service still limits every one of
    // these to their own record.
    const writes = [
      "journal:create",
      "downtime:write",
      "attachments:write",
      "tasks:update",
      "comments:update",
      // Members log their own routine occurrences.
      "routines:log",
    ];
    expect(member).toEqual(expect.arrayContaining(writes));
    expect(member).toContain("journal:read");
    // Nothing else that isn't a plain read.
    expect(member.every((p) => p.endsWith(":read") || writes.includes(p))).toBe(true);
    expect(member).not.toContain("journal:appraise");
    expect(member).not.toContain("assets:create");
    // Correcting your own words is a Member's; erasing them, or touching anyone
    // else's, is not.
    expect(member).not.toContain("comments:delete");
    expect(member).not.toContain("comments:moderate");
  });
});

describe("AREA_ROLES", () => {
  it("grants only what its own area needs", () => {
    const byName = new Map(AREA_ROLES.map((r) => [r.name, r.permissions]));

    // An assets admin runs the register — and nothing outside it.
    const assets = byName.get("Assets & devices admin")!;
    expect(assets).toContain("assets:delete");
    expect(assets).toContain("devices:create");
    expect(assets).not.toContain("users:read");
    expect(assets).not.toContain("settings:manage");

    // A viewer reads and no more.
    expect(byName.get("Assets & devices viewer")!.every((p) => p.endsWith(":read"))).toBe(true);

    // A reports role has to be able to read the journal a report is built from.
    expect(byName.get("Reports & analytics viewer")!).toContain("journal:read");
    expect(byName.get("Reports & analytics viewer")!).not.toContain("reports:manage");
    expect(byName.get("Reports & analytics admin")!).toContain("reports:manage");
  });

  it("keeps the destructive and bulk verbs to the admin tier", () => {
    const byName = new Map(AREA_ROLES.map((r) => [r.name, r.permissions]));

    // The whole point of the middle tier: daily work without the ability to
    // delete anything or bulk-load over it.
    const editor = byName.get("Assets & devices editor")!;
    expect(editor).toContain("assets:update");
    expect(editor).not.toContain("assets:delete");
    expect(editor).not.toContain("assets:import");

    // Access editor onboards people but cannot take over an account or invent
    // new access.
    const access = byName.get("Access editor")!;
    expect(access).toContain("users:create");
    expect(access).toContain("groups:assign");
    expect(access).not.toContain("users:reset-password");
    expect(access).not.toContain("users:manage-2fa");
    expect(access).not.toContain("roles:create");

    // System editor watches the system without being able to reconfigure it or
    // restore over the database.
    const system = byName.get("System editor")!;
    expect(system).toContain("logs:view");
    expect(system).toContain("audit:view");
    expect(system).not.toContain("settings:manage");
    expect(system).not.toContain("backups:manage");
    expect(system).not.toContain("debug:toggle");
  });

  it("gives the shifts middle tier approval without the schedule", () => {
    // shifts:approve and shifts:manage are separate permissions precisely so this
    // role can exist: decide a swap, do not own the roster.
    const byName = new Map(AREA_ROLES.map((r) => [r.name, r.permissions]));
    const editor = byName.get("Shifts editor")!;
    expect(editor).toContain("shifts:approve");
    expect(editor).not.toContain("shifts:manage");
  });

  it("puts backups behind their own role rather than only full admin", () => {
    // Restoring replaces the database. It should be delegable without handing
    // over everything else, which before this it was not.
    const byName = new Map(AREA_ROLES.map((r) => [r.name, r.permissions]));
    expect(byName.get("Backup operator")!).toEqual(["backups:manage"]);
  });

  it("names every role uniquely, and grants something", () => {
    const names = AREA_ROLES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(AREA_ROLES.every((r) => r.permissions.length > 0)).toBe(true);
  });
});
