// Author: Brijesh Dave <https://github.com/brijeshdave>
// The guard for every report that does not exist yet.
//
// Reports gained a permission each because one `reports:view` handed out the
// leaderboard along with the downtime figures — and, worse, handed out every
// report added afterwards without anybody deciding to. Fixing the seventeen that
// exist today is the easy half; the half that matters is that the eighteenth
// cannot slip through.
//
// So this reads the catalogue rather than any particular report: add a source to
// REPORT_SOURCES and these fail until it has a key, the key is in the permission
// catalogue, an administrator can grant it, and the runner narrows its rows the
// way the others do. None of that is remembered — it is required.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_PERMISSIONS,
  ALL_REPORT_VIEW_PERMISSIONS,
  REPORT_SCOPE,
  REPORT_SOURCES,
  REPORT_VIEW_PERMISSION,
} from "@reportly/shared";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(resolve(here, "../service.ts"), "utf8");

/** Every query a report reads its rows through — where the narrowing has to happen. */
const repoSources = [
  "../repo.ts",
  "../parts-repo.ts",
  "../../routines/completion-repo.ts",
  "../../routines/repo.ts",
  "../../shifts/schedule-repo.ts",
  "../../shifts/change-log-repo.ts",
].map((file) => readFileSync(resolve(here, file), "utf8"));

describe("every report is granted and scoped", () => {
  it("gives each report its own permission", () => {
    const missing = REPORT_SOURCES.filter((source) => !REPORT_VIEW_PERMISSION[source]);

    expect(
      missing,
      `These reports have no permission key, so they are open to anybody who can ` +
        `reach the Reports area:\n  ${missing.join("\n  ")}\n` +
        `Add one to REPORT_VIEW_PERMISSION and to PERMISSIONS.`,
    ).toEqual([]);
  });

  it("puts every report key in the permission catalogue", () => {
    const catalogue = new Set<string>(ALL_PERMISSIONS);
    const unknown = ALL_REPORT_VIEW_PERMISSIONS.filter((key) => !catalogue.has(key));

    // A key the catalogue does not know is a key the roles screen cannot show and
    // an administrator cannot grant — the report would be unreachable rather than
    // unguarded, which is a quieter failure and just as wrong.
    expect(
      unknown,
      `These report keys are not in PERMISSIONS, so nobody can be granted them:\n  ` +
        unknown.join("\n  "),
    ).toEqual([]);
  });

  it("covers exactly the reports that exist — no more, no fewer", () => {
    expect(ALL_REPORT_VIEW_PERMISSIONS).toHaveLength(REPORT_SOURCES.length);

    // A key left behind after a report is retired is a permission that grants
    // nothing, which is how three dead permissions got shipped before.
    const sources = new Set<string>(REPORT_SOURCES);
    const stale = ALL_REPORT_VIEW_PERMISSIONS.filter(
      (key) => !sources.has(key.replace("reports:view:", "")),
    );
    expect(stale, `Keys for reports that no longer exist:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("checks the permission where the report is resolved", () => {
    // The check cannot live on the route: which report is being run arrives in the
    // body, and a saved view names its own source. So it belongs beside the
    // definition, and this is what stops somebody moving it back to a route guard
    // that can only ever check one fixed key.
    expect(serviceSource).toContain("assertMayRead(ctx, definition.source)");
    expect(serviceSource).toContain("REPORT_VIEW_PERMISSION[");
  });

  it("narrows every report's rows to the reader", () => {
    // Not a proof that each query is right — that is what the integration tests
    // are for — but a proof that the runner takes the caller at all. A runner that
    // only receives a company id cannot narrow by site or by reporting line, which
    // is exactly how seven cartridge reports and three reliability views ended up
    // showing one plant's figures to another.
    const runners = [...serviceSource.matchAll(/async function (run\w+)\(([^)]*)\)/gs)];
    const blind = runners
      .filter(([, name]) => name !== "runReport")
      .filter(([, , args]) => !args.includes("ctx: AuthContext"))
      .map(([, name]) => name);

    expect(
      blind,
      `These report runners never see the caller, so they cannot narrow their rows ` +
        `to that person's sites or reporting line:\n  ${blind.join("\n  ")}`,
    ).toEqual([]);
  });

  it("makes every source declare how it narrows, and honours the declaration", () => {
    // The compiler already refuses a source missing from REPORT_SCOPE. What it
    // cannot see is whether the declaration means anything, so: a `people` report
    // must narrow by the reporting line somewhere in its path, and every report
    // must narrow by site. Stated here because the next report will be written by
    // somebody who has not read the plan, months from now.
    for (const source of REPORT_SOURCES) {
      expect(REPORT_SCOPE[source], `${source} declares no scope shape`).toMatch(/^(people|place)$/);
    }

    // The reporting line is only computed in one way; a people-shaped report that
    // never reaches it is one showing somebody else's work.
    expect(serviceSource).toContain("downlineUserIds");

    // And the site narrowing, which is the half that was missing everywhere. Both
    // helpers count: a row with a location column of its own uses one, and a row
    // whose site comes from the person in it uses the other.
    expect(
      repoSources.some(
        (src) => src.includes("withLocationsNullable(") || src.includes("withPersonLocations("),
      ),
      "no report query narrows its rows to the reader's sites",
    ).toBe(true);
  });
});
