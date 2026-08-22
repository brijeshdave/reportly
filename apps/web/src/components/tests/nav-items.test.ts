// Author: Brijesh Dave <https://github.com/brijeshdave>
// The sidebar must never advertise a page the API would refuse to serve.
import { PERMISSIONS } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { activeNavTo, greetingFor, visibleNavGroups } from "@/components/nav-items.js";

const anonymous = { permissions: [], isSuperadmin: false };

describe("visibleNavGroups", () => {
  it("shows nothing to a user with no permissions", () => {
    // A user in no group has no access at all — the sidebar must say so by
    // being empty, not by offering pages that then refuse them.
    expect(visibleNavGroups(anonymous)).toEqual([]);
  });

  it("drops groups whose every item is hidden", () => {
    const groups = visibleNavGroups({ permissions: [PERMISSIONS.LOGS_VIEW], isSuperadmin: false });
    expect(groups.map((group) => group.label)).toEqual(["System"]);
  });

  it("never advertises a route that does not exist", () => {
    // Every nav target must be a real route. /journal now exists (the reports
    // domain); a target with no route would be a 404 for every signed-in user.
    const targets = visibleNavGroups({ permissions: [], isSuperadmin: true }).flatMap((group) =>
      group.items.map((item) => item.to),
    );
    expect(targets).not.toContain("/features");
  });

  it("reveals an item once its permission is granted", () => {
    const groups = visibleNavGroups({ permissions: [PERMISSIONS.USERS_READ], isSuperadmin: false });
    const labels = groups.flatMap((group) => group.items.map((item) => item.label));
    expect(labels).toContain("Users");
    expect(labels).not.toContain("Groups");
  });

  it("gives tags:manage its own way in, without the page of catalogues around it", () => {
    // Why Tags left Journal setup: holding one catalogue's permission should not
    // mean opening a page of four to reach it.
    const groups = visibleNavGroups({
      permissions: [PERMISSIONS.TAGS_MANAGE],
      isSuperadmin: false,
    });
    const labels = groups.flatMap((group) => group.items.map((item) => item.label));
    expect(labels).toEqual(["Tags"]);
    expect(groups.map((group) => group.label)).toEqual(["System"]);
  });

  it("shows the Reports group only to someone who may view reports", () => {
    const without = visibleNavGroups({
      permissions: [PERMISSIONS.JOURNAL_READ],
      isSuperadmin: false,
    });
    expect(without.map((g) => g.label)).not.toContain("Reports");

    const withReports = visibleNavGroups({
      permissions: [PERMISSIONS.REPORTS_VIEW_JOURNAL],
      isSuperadmin: false,
    });
    expect(withReports.map((g) => g.label)).toContain("Reports");
  });

  it("drops a whole group when the module behind it is switched off", () => {
    // The cartridges entries are the first that depend on a per-COMPANY switch
    // rather than a permission. A superadmin at a company that does not refill
    // cartridges must not see the heading at all — every route under it would
    // 404, and an empty group is worse than no group.
    const groups = visibleNavGroups({ permissions: [], isSuperadmin: true }, [
      "/cartridges",
      "/cartridges/setup",
    ]);
    expect(groups.map((group) => group.label)).not.toContain("Cartridges");
  });

  it("shows everything to a superadmin", () => {
    const groups = visibleNavGroups({ permissions: [], isSuperadmin: true });
    const labels = groups.flatMap((group) => group.items.map((item) => item.label));
    // Locations are absent on purpose: they live inside a company's detail page.
    expect(labels).toEqual([
      "Journal",
      "Reviews",
      "Tasks",
      "Downtime",
      "Analytics",
      "Insights",
      "Reports",
      "Leaderboard",
      "My points",
      "Schedule",
      "Shift change",
      "Shifts",
      "My routines",
      "Team routines",
      "Assets",
      "Devices",
      // Present for a superadmin here because this call passes no disabled list.
      // In the app the shell passes one, and a company without the cartridges
      // module never sees these two however its permissions read.
      "Cartridges",
      "Cartridge setup",
      "Companies",
      "Departments",
      "Organisation",
      "Users",
      "Designations",
      "Groups",
      "Roles",
      "JournalEntry setup",
      "Tags",
      "Settings",
      "Single sign-on",
      "Logs",
      "Messages",
      "Audit",
      "Backups",
      "Queues",
    ]);
  });

  it("hides an entry the server has switched off, whatever the permission says", () => {
    // Queues is the first entry gated by the installation as well as the person.
    // A superadmin on a server running with QUEUE_ADMIN unset must not be offered
    // a link to a page whose every request 404s.
    const groups = visibleNavGroups({ permissions: [], isSuperadmin: true }, ["/queues"]);
    const labels = groups.flatMap((group) => group.items.map((item) => item.label));
    expect(labels).not.toContain("Queues");
    // And nothing else moved.
    expect(labels).toContain("Backups");
  });
});

describe("activeNavTo", () => {
  const tos = ["/companies", "/settings", "/settings/sso", "/logs"];

  it("lights the most specific match, not a parent prefix", () => {
    // The bug this guards: /settings/sso used to light up both Settings and SSO.
    expect(activeNavTo("/settings/sso", tos)).toBe("/settings/sso");
    expect(activeNavTo("/settings", tos)).toBe("/settings");
  });

  it("keeps a parent active on its own detail routes", () => {
    expect(activeNavTo("/companies/abc-123", tos)).toBe("/companies");
  });

  it("is null when nothing matches", () => {
    expect(activeNavTo("/profile", tos)).toBeNull();
  });
});

describe("greetingFor", () => {
  it.each([
    [new Date(2026, 0, 1, 6), "Good morning"],
    [new Date(2026, 0, 1, 11, 59), "Good morning"],
    [new Date(2026, 0, 1, 12), "Good afternoon"],
    [new Date(2026, 0, 1, 17, 59), "Good afternoon"],
    [new Date(2026, 0, 1, 18), "Good evening"],
    [new Date(2026, 0, 1, 23), "Good evening"],
  ])("%s → %s", (date, expected) => {
    expect(greetingFor(date)).toBe(expected);
  });
});
