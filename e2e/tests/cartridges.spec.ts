// Author: Brijesh Dave <https://github.com/brijeshdave>
// A cartridge through its whole life, in a browser.
//
// Two things here cannot be proved anywhere else. The first is the module switch:
// the group is absent from the sidebar until a company turns it on, and that is a
// fact about the session, the nav filter and the setting endpoint agreeing —
// three parts, none of which can be wrong on its own.
//
// The second is the reversal. It runs across five screens and a points ledger,
// and every unit and integration test around it necessarily calls the pieces
// directly. This is the only place that presses the buttons a technician presses
// and then goes and looks at the ledger.
import { expect, test } from "@playwright/test";

import { openNavGroup, pickFromCombo, unique } from "./helpers.js";

/**
 * The company's Modules tab, which is where the switch lives.
 *
 * The seeded company by its row rather than by name: the name is the seed's
 * business, and a spec that hardcodes it breaks the day somebody renames the
 * fixture — which is a change to a demo string, not to this feature.
 */
async function openModules(page: import("@playwright/test").Page) {
  await page.goto("/companies");
  await page.getByRole("table").getByRole("link").first().click();
  await page.getByRole("tab", { name: "Modules" }).click();
}

test.describe.configure({ mode: "serial" });

/**
 * Pick a company before every test.
 *
 * The choice lives in localStorage, which a new browser context does not inherit
 * from the saved session — so a test that relies on the previous one having
 * chosen gets "X-Company-Id header is required" on its first request. Which is
 * the API being right: with "All companies" selected there is no company to ask
 * whether it refills cartridges.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Active company").selectOption({ index: 1 });
});

test("the sidebar follows the company's switch, both ways", async ({ page }) => {
  // Switched off first rather than assumed off. A spec that depends on the state
  // a previous run left behind passes alone and fails in the suite, which this
  // one duly did — the webServer is reused, so the database is not always fresh.
  // That the DEFAULT is off is an API fact, and is asserted there.
  await openModules(page);
  // Wait for whichever button the panel settles on before reading it. `isVisible()`
  // does not auto-wait, so asking it while the tab is still loading answers "no"
  // truthfully and uselessly — and the spec then skips the click it needed.
  const toggle = page.getByRole("button", { name: /^Switch (on|off)$/ });
  await toggle.waitFor();
  if ((await toggle.textContent())?.includes("off")) await toggle.click();
  await expect(page.getByRole("button", { name: "Switch on" })).toBeVisible();

  await page.goto("/");
  // Nothing in the sidebar, for a superadmin holding every permission there is.
  // A permission is about the person; this is about the company.
  await expect(page.getByRole("button", { name: "Cartridges", exact: true })).toHaveCount(0);

  await openModules(page);
  await page.getByRole("button", { name: "Switch on" }).click();
  // The failure window appears with it, because it only means anything once the
  // module is on.
  await expect(page.getByLabel("Failure window (days)")).toBeVisible();

  await page.goto("/");
  await openNavGroup(page, "Cartridges");
  await expect(page.getByRole("link", { name: "Cartridges", exact: true })).toBeVisible();
});

test("a cartridge goes out, comes back faulty, and the points are taken back", async ({ page }) => {
  const identifier = unique("TN");
  const kind = unique("Refill");
  const deviceType = unique("Printer");
  const printer = unique("Office printer");

  // --- a printer to put one in ---
  // Built through the screens rather than seeded, because "which printers does
  // this fit" is the one relationship the module borrows from the rest of the
  // app, and a fixture inserted behind the UI would not prove it is reachable.
  await page.goto("/journal-config?tab=device-types");
  // Device types belong to a department, and the tab opens on whichever sorts
  // first. Naming it here keeps this in step with the device below — a type in
  // one department and a device in another simply do not meet.
  await pickFromCombo(page, "Department", "Engineering");
  await page.getByPlaceholder("e.g. Pump").fill(deviceType);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // The saved row is an editable text box, so its name is a value rather than
  // text on the page. Its delete button carries the name.
  await expect(page.getByRole("button", { name: `Delete ${deviceType}` })).toBeVisible();

  await page.goto("/devices/new");
  await page.getByLabel("Name").fill(printer);
  await pickFromCombo(page, "Department", "Engineering");
  await pickFromCombo(page, "Type", deviceType);
  await page.getByRole("button", { name: /save|create/i }).click();

  // --- the catalogues, which the register needs before it can hold anything ---
  await page.goto("/cartridges/setup?tab=kinds");
  await page.getByLabel("Name").fill(kind);
  await page.getByLabel("Default points").fill("4");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(kind)).toBeVisible();

  await page.goto("/cartridges/setup?tab=consumables");
  await page.getByLabel("Name").fill("Toner powder");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await page.goto("/cartridges/setup?tab=models");
  await page.getByRole("button", { name: "Add model" }).click();
  await page.getByLabel("Name").fill("Test cartridge");
  await page.getByLabel("Rated pages").fill("2000");
  // Compatibility is by device type: without this tick, the install below is
  // refused, which is the guard doing its job rather than a broken test.
  await page.getByRole("checkbox", { name: deviceType }).check();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Test cartridge")).toBeVisible();

  // --- register it ---
  await page.goto("/cartridges");
  await page.getByRole("button", { name: "Register" }).click();
  await page.getByLabel("Identifier").fill(identifier);
  await pickFromCombo(page, "Model", "Test cartridge");
  await page.getByRole("button", { name: "Register" }).last().click();
  // The register is a table now, so the identifier is a link in its own cell.
  await page.getByRole("link", { name: identifier }).click();
  await expect(page.getByRole("heading", { name: identifier })).toBeVisible();

  // Registered the default way: collected for refilling, so not usable yet and
  // not installable. This is the distinction "in stock" used to hide.
  await expect(page.getByText("Needs service")).toBeVisible();
  await expect(page.getByRole("button", { name: "Install" })).toHaveCount(0);

  // --- refill it, which pays, and is what makes it ready ---
  await page.getByRole("button", { name: "Service", exact: true }).click();
  await page.getByLabel("What was done").selectOption({ label: kind });
  await page.getByLabel(/Toner powder used/).fill("85");
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByText("Ready")).toBeVisible();

  await page.getByRole("button", { name: "Install" }).click();
  // The picker offers only machines this model fits, named with their type. The
  // company also owns desktops and switches by now; none of them are here, which
  // is the point — a picker that leads people into refusals stops being trusted.
  await page.getByLabel("Printer", { exact: true }).click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(1); // just the one that fits
  await expect(options.first()).toHaveText(new RegExp(`${printer}${deviceType}`));
  await options.first().click();
  await page.getByLabel("Printer's page counter").fill("48120");
  await page.getByRole("button", { name: "Install", exact: true }).last().click();
  await page.getByRole("button", { name: "Book in" }).click();
  // The closing reading, against the opening one taken above: 1,600 pages of a
  // rated 2,000. The form says what it read on the way in, which is the whole
  // reason for taking two readings rather than asking anybody to subtract.
  await expect(page.getByText(/48,120 when this cartridge went in/)).toBeVisible();
  await page.getByLabel("Printer's page counter").fill("49720");
  await page.getByRole("button", { name: "Book in", exact: true }).last().click();

  await expect(page.getByText(/1,600/).first()).toBeVisible();
  await expect(page.getByText(/80% of rated/)).toBeVisible();
  // Out of a machine means not usable, whatever the outcome.
  await expect(page.getByText("Needs service")).toBeVisible();

  await page.getByRole("button", { name: "Service", exact: true }).click();
  await page.getByLabel("What was done").selectOption({ label: kind });
  await page.getByLabel(/Toner powder used/).fill("85");
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByText(`${kind}`).first()).toBeVisible();
  // Serviced is what earns "ready", and ready is what an install accepts.
  await expect(page.getByText("Ready")).toBeVisible();

  // --- send it out and have it fail ---
  await page.getByRole("button", { name: "Install" }).click();
  await pickFromCombo(page, "Printer", printer);
  await page.getByRole("button", { name: "Install", exact: true }).last().click();

  await page.getByRole("button", { name: "Book in" }).click();
  await page.getByLabel("How did it end?").selectOption("faulty");
  await page.getByRole("button", { name: "Book in", exact: true }).last().click();

  // Said at the moment it happens. A reversal somebody discovers on a leaderboard
  // next week is one they will not believe.
  await expect(page.getByRole("heading", { name: "Points taken back" })).toBeVisible();
  await page.getByRole("button", { name: "Understood" }).click();

  // Both entries survive on the part: the award and its reversal side by side,
  // because a score that drops with nothing to show for it is worse.
  await expect(page.getByText(/reversed — came back faulty/)).toBeVisible();
});

test("the ledger shows the cartridge points and their reversal", async ({ page }) => {
  await page.goto("/points");
  await page.getByLabel(/source/i).selectOption("service");

  // Net zero, and visible as two rows rather than one adjusted one — the ledger
  // is append-only, so nothing was edited or deleted to get there.
  await expect(page.getByText(/reversed — came back faulty/)).toBeVisible();
  await expect(page.getByRole("main").getByText("-4", { exact: true })).toBeVisible();
});

test("switching the module off hides it without destroying anything", async ({ page }) => {
  await openModules(page);
  await page.getByRole("button", { name: "Switch off" }).click();

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Cartridges", exact: true })).toHaveCount(0);

  // And back on: the register is exactly as it was. Off means out of reach, never
  // deleted — a company that switches a module off by mistake must not lose a
  // year of history to it.
  await openModules(page);
  await page.getByRole("button", { name: "Switch on" }).click();
  await page.goto("/cartridges");
  await expect(page.getByRole("heading", { name: "Cartridges", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^TN-/ }).first()).toBeVisible();
});
