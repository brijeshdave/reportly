// Author: Brijesh Dave <https://github.com/brijeshdave>
// Captures the documentation screenshots from a running app.
//
// Committed rather than run once by hand, because screenshots rot faster than
// prose: a stale PNG showing a screen that no longer exists is worse than no
// screenshot at all. This regenerates them all from `cli seed:demo`, so refreshing
// the set after a UI change is one command rather than an afternoon.
//
// Usage — against a stack already running on the demo database:
//
//   BASE_URL=http://localhost:5273 \
//   SUPERADMIN_PASSWORD=... \
//   pnpm --filter @reportly/e2e exec tsx screenshots.ts
//
// Name shots to capture only those — adding one page should not rewrite thirteen
// PNGs whose only difference is a later date in the seed:
//
//   pnpm --filter @reportly/e2e exec tsx screenshots.ts cartridges
//
// It signs in once and reuses the session, so a run costs one sign-in rather than
// one per page.
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5273";
const EMAIL = process.env.SUPERADMIN_EMAIL ?? "admin@reportly.local";
const PASSWORD = process.env.SUPERADMIN_PASSWORD;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../docs/screenshots");

/** Wide enough for the sidebar and a data table, short enough to read in a README. */
const VIEWPORT = { width: 1440, height: 900 };

interface Shot {
  name: string;
  path: string;
  /**
   * Anything the page needs before it shows data at all — a filter chosen, a tab
   * opened. Screens that open on a "pick something" empty state produce a
   * technically-correct screenshot that demonstrates nothing, which is worse than
   * having none.
   */
  prepare?: (page: Page) => Promise<unknown>;
  /** Something that proves the page has actually rendered its data. */
  ready: (page: Page) => Promise<unknown>;
}

const SHOTS: Shot[] = [
  {
    name: "dashboard",
    path: "/",
    ready: (page) => page.getByRole("heading", { name: /dashboard/i }).waitFor(),
  },
  {
    name: "journal-list",
    // The page opens on "My day" now, which is a set of summary cards and no
    // table at all. This shot is of the journal itself, so it asks for the
    // Entries tab by name rather than trusting whichever tab happens to be first.
    path: "/journal?tab=entries",
    ready: (page) => page.getByRole("table").waitFor(),
  },
  {
    name: "journal-my-day",
    path: "/journal",
    // The other half of the same page: what is on one person's plate today.
    ready: (page) => page.getByText("Your points").waitFor(),
  },
  {
    name: "analytics",
    path: "/analytics",
    ready: (page) => page.getByRole("heading", { name: /analytics/i }).waitFor(),
  },
  {
    name: "leaderboard",
    path: "/reports/leaderboard",
    // Opens on "Pick a department" and shows nothing until one is chosen.
    // Targeted by its own options rather than by position: the first <select> on
    // any page is the company switcher in the topbar, and picking that one
    // changes the company while leaving the empty state exactly as it was.
    prepare: async (page) => {
      const picker = page.locator("select").filter({ hasText: "Choose a department" });
      await picker.waitFor();
      // By name, not by index: the list is the department tree, so position
      // depends on the shape of the org. Engineering is where seed:demo puts
      // everybody, and picking an empty department yields "No points yet" —
      // a screenshot of a working feature looking broken.
      const value = await picker
        .locator("option")
        .filter({ hasText: "Engineering" })
        .first()
        .getAttribute("value");
      if (!value) throw new Error("no Engineering option in the department picker");
      await picker.selectOption(value);
    },
    ready: (page) => page.getByRole("heading", { name: "Leaderboard", exact: true }).waitFor(),
  },
  {
    name: "insights",
    path: "/insights",
    ready: (page) => page.getByRole("heading", { name: "Insights", exact: true }).waitFor(),
  },
  {
    name: "notifications-bell",
    path: "/",
    // The panel is the point, so it has to be open. Without the click this
    // captures a dashboard with a small bell icon in the corner — technically
    // the right page, and a screenshot of nothing.
    prepare: async (page) => {
      await page.getByRole("heading", { name: /dashboard/i }).waitFor();
      await page.getByRole("button", { name: /notifications/i }).click();
    },
    ready: (page) => page.getByRole("menu", { name: "Notifications" }).waitFor(),
  },
  {
    name: "notifications-preferences",
    path: "/profile?tab=notifications",
    ready: (page) => page.getByRole("table").first().waitFor(),
  },
  {
    name: "notifications-settings",
    path: "/settings?tab=notifications",
    ready: (page) => page.getByRole("table").first().waitFor(),
  },
  {
    name: "queues",
    path: "/queues",
    // Only reachable when the server runs with QUEUE_ADMIN set; the generator
    // is pointed at a demo stack that has it on.
    ready: (page) => page.getByRole("heading", { name: "Queues", exact: true }).waitFor(),
  },
  {
    name: "cartridges",
    path: "/cartridges",
    // `seed:demo` switches the module on for the demo company and leaves four
    // parts in four different states, which is the whole point of the shot.
    ready: (page) => page.getByRole("heading", { name: "Cartridges", exact: true }).waitFor(),
  },
  {
    name: "cartridge-detail",
    path: "/cartridges",
    // The register is a grid of links, so the detail page is reached by clicking
    // one rather than by a path — the ids are fixed by the seed, but a path here
    // would rot the moment the seed changed.
    prepare: async (page) => {
      await page.getByRole("heading", { name: "Cartridges", exact: true }).waitFor();
      // TN-0044 is the one that came back faulty, so its histories have both the
      // reversal and a failed tour of duty in them.
      //
      // By role and first: since the register became a sortable table the
      // identifier appears twice — once in the row and once in the narrow-screen
      // card — and a bare text match resolves to both.
      await page.getByRole("link", { name: "TN-0044" }).first().click();
    },
    ready: (page) => page.getByRole("heading", { name: "TN-0044" }).waitFor(),
  },
  {
    name: "assets",
    path: "/assets",
    ready: (page) => page.getByRole("heading", { name: /assets/i }).waitFor(),
  },
  {
    name: "reports",
    path: "/reports",
    // `exact`: the page has an h1 "Reports" plus h2s that also contain the word.
    ready: (page) => page.getByRole("heading", { name: "Reports", exact: true }).waitFor(),
  },
  {
    name: "roles",
    path: "/roles",
    ready: (page) => page.getByRole("table").waitFor(),
  },
  {
    name: "organization",
    path: "/organization",
    ready: (page) => page.getByRole("heading", { name: /organi/i }).waitFor(),
  },
];

async function main(): Promise<void> {
  if (!PASSWORD) {
    throw new Error(
      "SUPERADMIN_PASSWORD is required. Get one with `cli reset-superadmin` against the demo database.",
    );
  }

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  // `exact` matters: the field shares its label prefix with the "Show password"
  // toggle beside it, and a loose match resolves to both.
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });

  // Pick the demo company explicitly. A superadmin lands on "All companies",
  // which is a legitimate view but not the one an ordinary screenshot should
  // show — and leaving it unset made the company depend on whatever an earlier
  // page happened to select.
  const companySwitcher = page.locator("header select, [role='banner'] select").first();
  await companySwitcher.selectOption({ index: 1 }).catch(async () => {
    await page.locator("select").first().selectOption({ index: 1 });
  });
  await page.waitForLoadState("networkidle");

  // Named on the command line, capture only those. Adding one page should not
  // rewrite thirteen PNGs whose only change is a different day in the seed.
  const only = new Set(process.argv.slice(2));
  const wanted = only.size > 0 ? SHOTS.filter((shot) => only.has(shot.name)) : SHOTS;
  const unknown = [...only].filter((name) => !SHOTS.some((shot) => shot.name === name));
  if (unknown.length > 0) throw new Error(`No such screenshot: ${unknown.join(", ")}`);

  const failures: string[] = [];
  for (const shot of wanted) {
    try {
      await page.goto(`${BASE_URL}${shot.path}`);
      if (shot.prepare) await shot.prepare(page);
      await shot.ready(page);
      // Let the data settle rather than catching a spinner mid-flight.
      await page.waitForLoadState("networkidle");
      // networkidle is not enough on its own: a panel that has already had its
      // response can still be rendering its spinner. Wait for every one to go.
      await page
        .locator(".animate-spin")
        .first()
        .waitFor({ state: "hidden", timeout: 15_000 })
        .catch(() => {
          /* no spinner on the page at all is the common case */
        });
      await page.screenshot({ path: resolve(outDir, `${shot.name}.png`), fullPage: false });
      console.log(`  captured ${shot.name}`);
    } catch (err) {
      // One unreachable page must not cost the whole set — collect and report.
      failures.push(`${shot.name} (${shot.path}): ${err instanceof Error ? err.message : err}`);
      console.error(`  FAILED   ${shot.name}`);
    }
  }

  await browser.close();

  if (failures.length > 0) {
    console.error(`\n${failures.length} screenshot(s) failed:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${wanted.length} screenshots written to docs/screenshots/`);
  }
}

await main();
